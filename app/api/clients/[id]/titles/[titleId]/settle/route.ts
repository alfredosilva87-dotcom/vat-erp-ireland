import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { baixarPeloBanco } from "@/lib/accounting/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A BAIXA do título, pela conta bancária escolhida.
 *
 * Uma chamada faz as três coisas: tira o dinheiro do banco, abate o título e
 * escreve a partida no razão. Ver `baixarPeloBanco` em
 * `lib/accounting/service.ts` para a ordem e o porquê dela.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; titleId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const body = await req.json().catch(() => ({}));
  const bankAccountId = String(body?.bank_account_id || "");
  const settledOn = String(body?.settled_on || "");
  const amount = Number(body?.amount);

  if (!bankAccountId) return NextResponse.json({ error: "Escolha a conta bancaria." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(settledOn)) {
    return NextResponse.json({ error: "Data da baixa invalida." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "O valor tem de ser maior que zero." }, { status: 400 });
  }

  const user = await getSessionUser();
  const r = await baixarPeloBanco({
    clientId: params.id, ledgerItemId: params.titleId,
    bankAccountId, settledOn, amount, userId: user?.id ?? null,
  });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json(r);
}

/**
 * Desfaz uma baixa.
 *
 * Apaga a partida, a linha de baixa e o movimento no banco — os três, porque
 * os três nasceram juntos. Deixar o movimento para trás daria um extrato com
 * um pagamento que o título já não conhece, e é assim que se cria uma
 * diferença que ninguém consegue explicar seis meses depois.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; titleId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const settlementId = new URL(req.url).searchParams.get("settlement");
  if (!settlementId) return NextResponse.json({ error: "Falta a baixa." }, { status: 400 });

  const sb = getServerSupabase();
  const { data: baixa } = await sb.from("ledger_settlements")
    .select("id,ledger_item_id,journal_id,bank_transaction_id")
    .eq("id", settlementId).eq("ledger_item_id", params.titleId).maybeSingle();
  if (!baixa) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const b = baixa as any;

  // O titulo tem de ser deste cliente: sem esta conferencia, um id de baixa de
  // outra empresa apagaria movimento bancario dela.
  const { data: dono } = await sb.from("ledger_items")
    .select("id").eq("id", params.titleId).eq("client_id", params.id).maybeSingle();
  if (!dono) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await sb.from("ledger_settlements").delete().eq("id", settlementId);
  if (b.journal_id) await sb.from("journal").delete().eq("id", b.journal_id);

  /*
   * O movimento no banco sai — mas COMO depende de onde ele veio.
   *
   * Há dois tipos, e tratá-los igual estraga um deles:
   *
   *   FABRICADO por esta app (`baixarPeloBanco`, sem `statement_line_id`).
   *   Nasceu com a baixa e não corresponde a nada no extrato. Desfeita a
   *   baixa, ele deixa de representar o que quer que seja: apaga-se.
   *
   *   VINDO DO EXTRATO (`statement_line_id` preenchido). O dinheiro MEXEU
   *   mesmo — está no extrato do banco, e nenhuma decisão aqui desfaz isso.
   *   Apagá-lo e deixar a linha do extrato marcada como conciliada era o pior
   *   dos dois: o movimento sumia da contabilidade e a linha continuava a
   *   dizer que já tinha sido tratada, então nunca mais aparecia na fila de
   *   conciliação. O dinheiro ficava invisível dos dois lados.
   *
   * Por isso a linha do extrato VOLTA para "por conciliar": o facto continua
   * lá, à espera de uma decisão nova.
   */
  if (b.bank_transaction_id) {
    const { data: txn } = await sb.from("bank_transactions")
      .select("id,statement_line_id").eq("id", b.bank_transaction_id)
      .eq("client_id", params.id).maybeSingle();
    const linha = (txn as any)?.statement_line_id ?? null;

    await sb.from("bank_transactions").delete().eq("id", b.bank_transaction_id).eq("client_id", params.id);

    if (linha) {
      // Só devolve a linha à fila se mais nenhum movimento a reclamar — uma
      // linha dividida em várias partes continua conciliada pelas outras.
      const { count } = await sb.from("bank_transactions")
        .select("id", { count: "exact", head: true }).eq("statement_line_id", linha);
      if (!count) {
        await sb.from("bank_statement_lines")
          .update({ status: "unreconciled", reconciled_at: null }).eq("id", linha);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
