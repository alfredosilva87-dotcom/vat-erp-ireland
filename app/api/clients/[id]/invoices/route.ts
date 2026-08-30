import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { listarInvoices, guardarRascunho } from "@/lib/invoicing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  return NextResponse.json({ invoices: await listarInvoices(params.id) });
}

/** Cria um RASCUNHO. Não consome número — ver lib/invoicing/service.ts. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const r = await guardarRascunho(params.id, null, await req.json(), (await getSessionUser())?.id ?? null);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ id: r.id });
}
