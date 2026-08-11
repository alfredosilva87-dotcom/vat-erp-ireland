import { NextRequest, NextResponse } from "next/server";
import { getBankAccount, listBankBalances } from "@/lib/bankStore";
import { pendingWithSuggestions, outstandingTransactions } from "@/lib/bankReconcile";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
// Nunca servir saldo ou linha de extrato de cache: o Next guarda resposta de
// GET por padrao, e uma tela de conciliacao que mostra trabalho ja feito e pior
// que uma tela lenta.
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; accountId: string } };

/**
 * Everything the reconciliation screen needs, in one request: the lines still
 * waiting with what the system proposes for each, the documents it chose from,
 * and the payments posted here that no line explains yet.
 *
 * The matching runs on the server because the candidate documents are the whole
 * client's ledger — sending it all to the browser to rank it there would move
 * the client's purchase history into the page for no gain.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const account = await getBankAccount(params.accountId);
  if (!account || account.client_id !== params.id) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }

  const [{ lines, candidates }, outstanding, balances] = await Promise.all([
    pendingWithSuggestions(account.id, params.id),
    outstandingTransactions(account.id),
    listBankBalances(params.id),
  ]);

  return NextResponse.json({
    account,
    balance: balances.find((b) => b.bank_account_id === account.id) ?? null,
    lines,
    candidates,
    outstanding,
  });
}
