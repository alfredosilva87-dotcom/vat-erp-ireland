import { NextRequest, NextResponse } from "next/server";
import {
  getBankAccount, updateBankAccount, deleteBankAccount,
  listBankBalances, listStatementLines, listBankImports,
} from "@/lib/bankStore";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";
// Nunca servir saldo ou linha de extrato de cache: o Next guarda resposta de
// GET por padrao, e uma tela de conciliacao que mostra trabalho ja feito e pior
// que uma tela lenta.
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; accountId: string } };

/**
 * An account id in the URL says nothing about who it belongs to. Every route
 * here checks it really hangs off the client in the path, so a wrong (or
 * guessed) id cannot read another company's statement.
 */
async function ownedAccount(params: Ctx["params"]) {
  const account = await getBankAccount(params.accountId);
  return account && account.client_id === params.id ? account : null;
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const account = await ownedAccount(params);
  if (!account) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });

  const q = req.nextUrl.searchParams;
  const [balances, lines, imports] = await Promise.all([
    listBankBalances(params.id),
    listStatementLines(account.id, {
      from: q.get("from"),
      to: q.get("to"),
      status: q.get("status") as any,
      limit: Number(q.get("limit")) || 500,
    }),
    listBankImports(account.id),
  ]);

  return NextResponse.json({
    account,
    balance: balances.find((b) => b.bank_account_id === account.id) ?? null,
    lines,
    imports,
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  if (!(await ownedAccount(params))) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }
  const account = await updateBankAccount(params.accountId, (await req.json()) || {});
  return NextResponse.json({ account });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  // Deleting the account takes its statement lines with it (cascade), so this
  // is the most destructive button in the reconciliation area.
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  if (!(await ownedAccount(params))) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }
  return NextResponse.json({ ok: await deleteBankAccount(params.accountId) });
}
