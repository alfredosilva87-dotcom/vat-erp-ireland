import { NextRequest, NextResponse } from "next/server";
import { deleteInboxItem, updateInboxItem } from "@/lib/mailStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { itemId: string } };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const body = await req.json().catch(() => ({}));
  const patch: any = {};
  for (const k of ["status", "client_id", "direction", "invoice_id", "invoice_count", "refused_reason"]) {
    if (k in body) patch[k] = body[k];
  }
  const item = await updateInboxItem(params.itemId, patch);
  if (!item) return NextResponse.json({ error: "Item não encontrado." }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const out = await deleteInboxItem(params.itemId);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
