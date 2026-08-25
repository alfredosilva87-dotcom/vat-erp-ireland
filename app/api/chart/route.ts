import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAccount, listSharedAccounts, updateAccount } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O PLANO DE CONTAS DO ESCRITÓRIO — fora de qualquer cliente.
 *
 * Fica aqui e não dentro de `/clients/[id]/` porque o plano é de TODOS os
 * clientes. Editá-lo de dentro de um deles mente: a tela pareceria estar a
 * mexer naquela empresa quando mexe nas trinta e cinco. É a mesma razão que
 * pôs o RH no menu geral.
 *
 * Não tem guarda de empresa porque não há empresa a guardar: é referência
 * global, como a base de alíquotas e o catálogo de itens.
 */
export async function GET() {
  const guard = await requireRole("user");
  if ("error" in guard) return guard.error;
  return NextResponse.json({ accounts: await listSharedAccounts() });
}

/** Criar ou alterar conta do escritório exige perfil admin. */
export async function POST(req: NextRequest) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  try {
    const account = await createAccount(null, body || {});
    if (!account) return NextResponse.json({ error: "O código da conta é obrigatório." }, { status: 400 });
    return NextResponse.json({ account });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falhou." }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  if (!id) return NextResponse.json({ error: "Falta a conta." }, { status: 400 });
  try {
    return NextResponse.json({ account: await updateAccount(id, body) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falhou." }, { status: 400 });
  }
}
