import { NextRequest, NextResponse } from "next/server";
import { getBankAccount } from "@/lib/bankStore";
import { reconcileLine, unlinkLine, undoLine, linkExistingTransaction } from "@/lib/bankReconcile";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
// Nunca servir saldo ou linha de extrato de cache: o Next guarda resposta de
// GET por padrao, e uma tela de conciliacao que mostra trabalho ja feito e pior
// que uma tela lenta.
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; accountId: string; lineId: string } };

async function guard(params: Ctx["params"]) {
  const account = await getBankAccount(params.accountId);
  return account && account.client_id === params.id ? account : null;
}

/** Confirma o casamento: cria a transação e liga à linha. */
export async function POST(req: NextRequest, { params }: Ctx) {
  if (!(await guard(params))) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));

  // Ligar a um movimento que já existe não lança nada — é o caminho de volta de
  // quem desconciliou. Sem ele, a única saída seria criar um segundo movimento
  // e contar o mesmo pagamento duas vezes.
  if (body?.transactionId) {
    const linked = await linkExistingTransaction(params.accountId, params.lineId, body.transactionId);
    if (!linked.ok) return NextResponse.json({ error: linked.error }, { status: 409 });
    return NextResponse.json(linked);
  }

  const result = await reconcileLine(
    params.accountId, params.id, params.lineId,
    {
      invoiceId: body?.invoiceId ?? null,
      saleId: body?.saleId ?? null,
      description: body?.description ?? null,
      accountCode: body?.accountCode ?? null,
      allocations: Array.isArray(body?.allocations) ? body.allocations : null,
      parts: Array.isArray(body?.parts) ? body.parts : null,
      contactName: body?.contactName ?? null,
      reason: body?.reason ?? "manual",
    },
    (await getSessionUser())?.id ?? null
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}

/**
 * As duas formas de voltar atrás, e a diferença importa:
 *
 *   ?mode=unlink → desconciliar. Some o vínculo, o pagamento continua na nota.
 *   ?mode=undo   → refazer. A transação é apagada e a nota volta a dever.
 */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  if (!(await guard(params))) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }
  const mode = req.nextUrl.searchParams.get("mode") === "undo" ? "undo" : "unlink";
  const result = mode === "undo"
    ? await undoLine(params.accountId, params.lineId)
    : await unlinkLine(params.accountId, params.lineId);
  return NextResponse.json({ ...result, mode });
}
