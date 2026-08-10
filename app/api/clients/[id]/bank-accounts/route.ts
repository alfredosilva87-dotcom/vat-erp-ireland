import { NextRequest, NextResponse } from "next/server";
import { listBankAccounts, listBankBalances, createBankAccount } from "@/lib/bankStore";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const [accounts, balances] = await Promise.all([
    listBankAccounts(params.id),
    listBankBalances(params.id),
  ]);
  return NextResponse.json({ accounts, balances });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const account = await createBankAccount(params.id, body || {});
  if (!account) return NextResponse.json({ error: "Nome da conta é obrigatório." }, { status: 400 });
  return NextResponse.json({ account });
}
