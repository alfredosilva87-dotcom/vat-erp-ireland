import { NextRequest, NextResponse } from "next/server";
import { getInvoice, updateInvoiceCredits, updateInvoice, deleteInvoice } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const data = await getInvoice(params.id);
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  // credits-only payload (legacy) vs general header/items edit
  const data =
    body?.credits && !body?.header && !body?.items
      ? await updateInvoiceCredits(params.id, body.credits as Record<string, boolean>)
      : await updateInvoice(params.id, { header: body?.header, items: body?.items });
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ok = await deleteInvoice(params.id);
  return NextResponse.json({ ok });
}
