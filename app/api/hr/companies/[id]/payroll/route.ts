import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { requireRole, getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { correrFolha, fecharFolha } from "@/lib/hr/folha";

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
    return NextResponse.json({ ok: true, reabertos: count ?? 0 });
  }

  const r = await fecharFolha({ clientId: params.id, ...a, userId: user?.id ?? null });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 409 });
  return NextResponse.json(r);
}
