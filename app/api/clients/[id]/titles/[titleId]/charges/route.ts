import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { contabilizarEncargo, descontabilizarEncargo } from "@/lib/accounting/service";
import { contaDoEncargo } from "@/lib/financial/chargeTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIPOS = ["interest", "fee", "penalty", "other", "discount"];

/** Acrescenta juro, taxa, multa, despesa — ou desconto — ao título. */
export async function POST(req: NextRequest, { params }: { params: { id: string; titleId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sb = getServerSupabase();
  // O título tem de ser DESTE cliente: o id vem do corpo do pedido, e sem esta
  // conferência daria para pendurar um encargo no título de outra empresa.
  // A NATUREZA vem daqui também, e é ela que decide a conta — ver abaixo.
  const { data: dono } = await sb.from("ledger_items")
    .select("id,kind").eq("id", params.titleId).eq("client_id", params.id).maybeSingle();
  if (!dono) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const natureza = (dono as any).kind === "receivable" ? "receivable" : "payable";

  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind || "");
  const amount = Number(body?.amount);
  if (!TIPOS.includes(kind)) {
    return NextResponse.json({ error: "Tipo de encargo desconhecido." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    // Sempre positivo; o sinal vem do tipo. Ver a migração 026.
    return NextResponse.json({ error: "O valor tem de ser maior que zero." }, { status: 400 });
  }

  /*
   * A CONTA é resolvida AQUI, pelo tipo e pela natureza do título — nunca pelo
   * que a tela mandou.
   *
   * Era daí que vinha o erro: a tela enviava "juros → 7100" fixo, e num título
   * a RECEBER isso creditava uma conta de despesa. Juro recebido é ganho.
   * Quem escolhe a conta tem de saber de que lado está, e a tela não sabe.
   *
   * A conta enviada pelo pedido é ignorada de propósito: aceitar uma sugestão
   * do cliente HTTP para uma decisão contábil é reabrir a mesma porta.
   */
  const { conta } = await contaDoEncargo(kind, natureza);

  const user = await getSessionUser();
  const { data, error } = await sb.from("ledger_charges").insert({
    ledger_item_id: params.titleId, kind, amount: Math.round(amount * 100) / 100,
    account_code: conta,
    description: String(body?.description || "").trim() || null,
    incurred_on: /^\d{4}-\d{2}-\d{2}$/.test(String(body?.incurred_on || ""))
      ? body.incurred_on : new Date().toISOString().slice(0, 10),
    created_by: user?.id ?? null,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  /*
   * O encargo vai ao razao na hora.
   *
   * Sem isto o valor em aberto subia no ecra e o balancete ficava a dever
   * exatamente essa diferenca. O resultado volta junto para a tela poder
   * mostrar a contrapartida — e para um cliente sem contabilidade integrada
   * saber que o titulo mudou e o razao nao.
   */
  const lancamento = await contabilizarEncargo((data as any).id, user?.id ?? null);
  return NextResponse.json({ ...(data as any), lancamento });
}

/** Remove um encargo lançado por engano. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; titleId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const chargeId = new URL(req.url).searchParams.get("charge");
  if (!chargeId) return NextResponse.json({ error: "Falta o encargo." }, { status: 400 });

  const sb = getServerSupabase();
  const { data: dono } = await sb.from("ledger_items")
    .select("id").eq("id", params.titleId).eq("client_id", params.id).maybeSingle();
  if (!dono) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // O lancamento sai ANTES da linha: apagar o encargo primeiro deixaria uma
  // partida no razao sem nada que a explique.
  await descontabilizarEncargo(chargeId);
  const { error } = await sb.from("ledger_charges")
    .delete().eq("id", chargeId).eq("ledger_item_id", params.titleId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
