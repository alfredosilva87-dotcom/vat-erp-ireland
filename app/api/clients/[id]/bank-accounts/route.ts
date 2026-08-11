import { NextRequest, NextResponse } from "next/server";
import { listBankAccounts, listBankBalances, createBankAccount } from "@/lib/bankStore";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
// Nunca servir saldo ou linha de extrato de cache: o Next guarda resposta de
// GET por padrao, e uma tela de conciliacao que mostra trabalho ja feito e pior
// que uma tela lenta.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const [accounts, balances] = await Promise.all([
    listBankAccounts(params.id),
    listBankBalances(params.id),
  ]);
  return NextResponse.json({ accounts, balances });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const body = await req.json();
  const account = await createBankAccount(params.id, body || {});
  if (!account) return NextResponse.json({ error: "Nome da conta é obrigatório." }, { status: 400 });
  return NextResponse.json({ account });
}
