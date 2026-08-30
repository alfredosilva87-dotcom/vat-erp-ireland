import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { criarLinkDeFatura, revogarLinkDeFatura } from "@/lib/invoicing/envio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cria (ou devolve) o endereço público da fatura — ver lib/invoicing/envio.ts. */
export async function POST(_req: NextRequest, { params }: { params: { id: string; invoiceId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const r = await criarLinkDeFatura(params.id, params.invoiceId);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ token: r.token });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; invoiceId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const r = await revogarLinkDeFatura(params.id, params.invoiceId);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true });
}
