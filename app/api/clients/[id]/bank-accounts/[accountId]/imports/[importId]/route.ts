import { NextRequest, NextResponse } from "next/server";
import { getBankAccount, listStatementLines, deleteBankImport } from "@/lib/bankStore";

export const runtime = "nodejs";
// Nunca servir saldo ou linha de extrato de cache: o Next guarda resposta de
// GET por padrao, e uma tela de conciliacao que mostra trabalho ja feito e pior
// que uma tela lenta.
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; accountId: string; importId: string } };

/**
 * Undo an import — the way out of "I picked the wrong file".
 *
 * Not admin-only on purpose: it is the immediate correction of a mistake the
 * person just made, and gating it behind someone else's login is how wrong
 * lines end up staying. It refuses once anything in the batch is reconciled,
 * which is the case that would actually lose information.
 */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const account = await getBankAccount(params.accountId);
  if (!account || account.client_id !== params.id) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }

  const belongs = await listStatementLines(account.id, { importId: params.importId, limit: 1 });
  if (!belongs.length) {
    return NextResponse.json({ error: "Lote não encontrado nesta conta." }, { status: 404 });
  }

  const result = await deleteBankImport(params.importId);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
  return NextResponse.json(result);
}
