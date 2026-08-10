import { NextRequest, NextResponse } from "next/server";
import { getClient, updateClient, deleteClient } from "@/lib/store";
import { requireRole, getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const company = (await getSessionUser())?.company_id ?? null;
  const client = await getClient(params.id, company);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ client });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const patch = await req.json();
  const client = await updateClient(params.id, patch);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ client });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  // Destructive: administrators only. The UI hides these buttons, but the
  // check has to live here to actually be a permission.
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const ok = await deleteClient(params.id);
  return NextResponse.json({ ok });
}
