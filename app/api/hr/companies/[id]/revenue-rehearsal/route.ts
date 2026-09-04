import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { requireRole, getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { ehClienteDeDemonstracao, rpnDeEnsaio } from "@/lib/revenue/ensaio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O ENSAIO DA REVENUE — semear RPN plausível, e dizer que é ensaio.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO EXISTE
 *
 * Não há certificado ROS instalado, e não vai haver durante este trabalho. Só
 * que a parte mais importante do RPN é justamente a que não se consegue mostrar
 * sem ele: os créditos e o cut-off repartidos pela Revenue, e o ACUMULADO de um
 * emprego anterior. É o que muda o desconto de quem entra a meio do ano — e sem
 * dados semeados a demonstração mostra sempre o caso pobre, com toda a gente a
 * começar do zero.
 *
 * ---------------------------------------------------------------------------
 * O QUE TORNA ISTO SEGURO, E NÃO UMA PORTA DAS TRASEIRAS
 *
 * Semear dado fiscal falso num sistema de folha é perigoso pela razão óbvia: se
 * ele passar por verdadeiro, alguém corre uma folha real com créditos que a
 * Revenue nunca deu, e o trabalhador leva a diferença como dívida. Cinco travas,
 * e nenhuma delas é opcional:
 *
 *  1. **Só clientes de demonstração.** O código do cliente tem de começar por
 *     `DEMO-`. Não é uma opção da configuração que alguém possa ligar: é o
 *     próprio cadastro que decide, e um cliente real nunca se chama assim.
 *  2. **Acto deliberado.** É preciso ser administrador E mandar a palavra
 *     `ENSAIO` no pedido. Um clique enganado noutro botão não chega aqui.
 *  3. **Nunca ligado por omissão.** Não há semeadura automática, nem no arranque
 *     nem na criação de cliente. Nada acontece sem alguém pedir.
 *  4. **Marcado nos dados.** `revenue_rpn.simulated` (migração 063) e o número
 *     do RPN com prefixo `SIM-`, que sai impresso no recibo. Quem olhar para o
 *     papel vê que é ensaio sem ter de perguntar a ninguém.
 *  5. **Nunca por cima do que é real.** Se já houver linha NÃO simulada para
 *     aquele emprego, salta-se e diz-se porquê. E a limpeza só apaga o que tem
 *     `simulated = true`.
 *
 * Se alguma destas cair, isto deixa de ser uma demonstração e passa a ser um
 * risco — e nesse caso a resposta certa é apagar a rota, não relaxar a trava.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const corpo = await req.json().catch(() => ({}));
  const acao = String(corpo?.acao || "");
  const year = Number(corpo?.year) || new Date().getFullYear();

  const sb = getServerSupabase();
  const { data: cliente } = await sb.from("clients")
    .select("id,name,client_code,employer_number,company_id").eq("id", params.id).maybeSingle();
  if (!cliente) return NextResponse.json({ codigo: "ensaio.semCliente" }, { status: 404 });

  // A TRAVA. Fora de um cliente de demonstração isto não corre, nem para
  // limpar: se não houve semeadura, não há nada para apagar.
  if (!ehClienteDeDemonstracao((cliente as any).client_code)) {
    return NextResponse.json(
      { codigo: "ensaio.soDemo", params: { quem: (cliente as any).name } }, { status: 403 }
    );
  }

  if (acao === "limpar") {
    const { error, count } = await sb.from("revenue_rpn")
      .delete({ count: "exact" })
      .eq("client_id", params.id).eq("tax_year", year).eq("simulated", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, apagados: count ?? 0 });
  }

  if (acao !== "semear") return NextResponse.json({ codigo: "ensaio.semAcao" }, { status: 400 });
  // A palavra por extenso: um POST disparado por engano não a traz.
  if (String(corpo?.confirmar || "") !== "ENSAIO") {
    return NextResponse.json({ codigo: "ensaio.semConfirmacao" }, { status: 400 });
  }

  const user = await getSessionUser();
  const companyId = (cliente as any).company_id ?? user?.company_id ?? null;
  if (!companyId) return NextResponse.json({ codigo: "ensaio.semEmpresa" }, { status: 409 });

  const { data: pessoas } = await sb.from("hr_employees")
    .select("id,first_name,surname,pps_number,employment_id,start_date")
    .eq("client_id", params.id).eq("active", true).order("first_name");
  const lista = (pessoas ?? []) as any[];

  const { data: existentes } = await sb.from("revenue_rpn")
    .select("employee_ppsn,employment_id,simulated")
    .eq("client_id", params.id).eq("tax_year", year);
  const jaLa = new Map<string, boolean>(
    ((existentes ?? []) as any[]).map((r) => [`${r.employee_ppsn}:${r.employment_id}`, !!r.simulated])
  );

  const employerReg = String((cliente as any).employer_number || "").trim() || `SIM${year}`;
  const feitos: { quem: string; rpn: string }[] = [];
  const saltados: { quem: string; codigo: string }[] = [];

  for (let i = 0; i < lista.length; i++) {
    const p = lista[i];
    const quem = [p.first_name, p.surname].filter(Boolean).join(" ");
    const pps = String(p.pps_number || "").trim();
    // Sem PPS não há RPN: a Revenue identifica a pessoa por ele, e inventar um
    // seria semear um identificador fiscal falso — outra coisa, e bem pior.
    if (!pps) { saltados.push({ quem, codigo: "ensaio.semPps" }); continue; }

    const employmentId = String(p.employment_id || "").trim() || "1";
    const chave = `${pps}:${employmentId}`;
    if (jaLa.has(chave)) {
      saltados.push({ quem, codigo: jaLa.get(chave) ? "ensaio.jaSemeado" : "ensaio.temReal" });
      continue;
    }

    const linha = rpnDeEnsaio({
      indice: i, year, pps, employmentId, employerReg,
      comAcumulado: !!corpo?.comAcumulado,
      quemPediu: user?.email ?? user?.id ?? null,
    });
    const { error } = await sb.from("revenue_rpn").insert({
      company_id: companyId, client_id: params.id, ...linha,
    });
    if (error) { saltados.push({ quem, codigo: "ensaio.erro" }); continue; }
    feitos.push({ quem, rpn: linha.rpn_number });
  }

  return NextResponse.json({ ok: true, year, feitos, saltados });
}
