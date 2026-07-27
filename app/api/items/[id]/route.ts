import { NextRequest, NextResponse } from "next/server";
import { updateMasterItem, deleteMasterItem } from "@/lib/store";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const patch = await req.json();
  const item = await updateMasterItem(params.id, patch);
  if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ ok: await deleteMasterItem(params.id) });
}
