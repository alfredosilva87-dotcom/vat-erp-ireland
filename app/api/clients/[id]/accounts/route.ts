import { NextRequest, NextResponse } from "next/server";
import { listAccounts, createAccount, bulkImportAccounts } from "@/lib/store";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  return NextResponse.json({ accounts: await listAccounts(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const body = await req.json();
  if (Array.isArray(body?.rows)) {
    const count = await bulkImportAccounts(params.id, body.rows);
    return NextResponse.json({ imported: count });
  }
  const account = await createAccount(params.id, body || {});
  if (!account) return NextResponse.json({ error: "Code is required." }, { status: 400 });
  return NextResponse.json({ account });
}
