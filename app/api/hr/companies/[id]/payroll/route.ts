import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { requireRole, getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { correrFolha, fecharFolha } from "@/lib/hr/folha";
import { garantirTitulosDaFolha, removerTitulosDaFolha } from "@/lib/financial/payrollTitles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FREQ = ["weekly", "fortnightly", "monthly"] as const;

function pedido(req: NextRequest, corpo?: any) {
  const q = new URL(req.url).searchParams;
  const freq = String(corpo?.freq ?? q.get("freq") ?? "weekly");
  return {
    year: Number(corpo?.year ?? q.get("year")) || new Date().getFullYear(),
    periodNo: Number(corpo?.period ?? q.get("period")) || 1,
    freqType: (FREQ.includes(freq as any) ? freq : "weekly") as (typeof FREQ)[number],
    payDate: String(corpo?.payDate ?? q.get("payDate") ?? "") || undefined,
  };
}

/** PRÉ-VISUALIZAR: calcula e não grava nada. Pode correr as vezes que forem. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const a = pedido(req);
  return NextResponse.json(await correrFolha({ clientId: params.id, ...a }));
}

/**
 * FECHAR a folha, ou REABRIR um período.
 *
 * Fechar é o acto que faz o número entrar no acumulado dos períodos seguintes.
 * Reabrir é o inverso, e é deliberado — nunca um efeito lateral de voltar à
 * tela. Os dois exigem admin: mexem em dinheiro já comunicado.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const corpo = await req.json().catch(() => ({}));
  const a = pedido(req, corpo);
  const user = await getSessionUser();

  if (corpo?.acao === "reabrir") {
    const sb = getServerSupabase();
    /*
     * Reabrir volta o payslip a rascunho — e não o apaga.
     *
     * Apagar levava o histórico junto: ficava sem forma de saber que aquela
     * semana chegou a ser fechada, e com que números. O gatilho da migração 050
     * deixa passar `final -> draft` exactamente para isto.
     */
    const { error, count } = await sb.from("hr_payslip")
      .update({ status: "draft", finalised_at: null, finalised_by: null,
        updated_at: new Date().toISOString() }, { count: "exact" })
      .eq("client_id", params.id).eq("year", a.year)
      .eq("period_no", a.periodNo).eq("freq_type", a.freqType)
      .eq("status", "final");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    /*
     * Reabrir desfaz os títulos a pagar que o fecho criou.
     *
     * Deixá-los para trás punha a empresa a dever duas vezes: os títulos do
     * período reaberto continuavam na lista, e o fecho seguinte criava outros —
     * com valores diferentes, porque a folha entretanto mudou, o que é o pior
     * dos casos porque as duas linhas parecem coisas distintas.
     *
     * O que já tem baixa fica: ver `removerTitulosDaFolha`.
     */
    const titulos = await removerTitulosDaFolha({
      clientId: params.id, year: a.year, periodNo: a.periodNo, freqType: a.freqType,
    });
    return NextResponse.json({ ok: true, reabertos: count ?? 0, titulos });
  }

  /*
   * SEGURAR e SOLTAR uma devolucao.
   *
   * A decisao e um ACTO de alguem, numa data, por uma razao — nao se deduz de
   * numero nenhum. Sem a gravar, reabrir e recalcular voltava a pagar a
   * devolucao que alguem tinha decidido segurar.
   */
  if (corpo?.acao === "segurar" || corpo?.acao === "soltar") {
    const sb = getServerSupabase();
    const empId = String(corpo?.employeeId || "");
    if (!empId) return NextResponse.json({ error: "Falta o funcionario." }, { status: 400 });

    // O funcionario tem de ser DESTE cliente: sem isto o id do pedido bastava
    // para mexer na folha de outra empresa.
    const { data: dono } = await sb.from("hr_employees")
      .select("id").eq("id", empId).eq("client_id", params.id).maybeSingle();
    if (!dono) return NextResponse.json({ error: "Not found." }, { status: 404 });

    if (corpo.acao === "soltar") {
      const { error } = await sb.from("hr_refund_hold").delete()
        .eq("employee_id", empId).eq("year", a.year)
        .eq("period_no", a.periodNo).eq("freq_type", a.freqType);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    const motivo = String(corpo?.reason || "").trim();
    // Uma decisao de tesouraria sem motivo escrito e indefensavel tres meses
    // depois, e e justamente ai que alguem pergunta.
    if (motivo.length < 3) {
      return NextResponse.json(
        { error: "Escreva porque esta a segurar a devolucao — fica no registo." }, { status: 400 }
      );
    }
    const { error } = await sb.from("hr_refund_hold").upsert({
      client_id: params.id, employee_id: empId, year: a.year,
      period_no: a.periodNo, freq_type: a.freqType,
      reason: motivo, created_by: user?.id ?? null,
    }, { onConflict: "employee_id,year,period_no,freq_type" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const r = await fecharFolha({ clientId: params.id, ...a, userId: user?.id ?? null });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 409 });

  /*
   * O TÍTULO A PAGAR NASCE AQUI, e nasce partido em dois.
   *
   * Até agora só o quadro semanal antigo criava título de folha. Fechar a folha
   * por este ecrã gravava os recibos e mais nada: o dinheiro saía do banco todo
   * o mês e não havia contra o quê o conciliar. Ver `garantirTitulosDaFolha` e
   * `lib/hr/titulosDaFolhaPuro.ts`.
   *
   * A folha JÁ ESTÁ fechada quando se chega aqui, e continua fechada mesmo que
   * isto falhe: um erro a criar títulos não pode desfazer recibos já gravados e
   * já comunicáveis. Por isso o resultado vai na resposta em vez de virar erro —
   * quem fechou vê o que ficou por fazer, e volta a correr depois.
   */
  const titulos = await garantirTitulosDaFolha({
    clientId: params.id, year: a.year, periodNo: a.periodNo, freqType: a.freqType,
    payDate: r.folha!.payDate, totais: r.folha!.totais, pessoas: r.folha!.linhas.length,
  });

  // A folha inteira não volta na resposta: o ecrã recarrega-a a seguir pelo GET,
  // e mandá-la duas vezes é o dobro do payload por nada.
  return NextResponse.json({ ok: true, gravados: r.gravados, titulos });
}
