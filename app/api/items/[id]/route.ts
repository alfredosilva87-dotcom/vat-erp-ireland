import { NextRequest, NextResponse } from "next/server";
import { updateMasterItem, deleteMasterItem } from "@/lib/store";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const patch = await req.json();
  const item = await updateMasterItem(params.id, patch);
  if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  // Destructive: administrators only. The UI hides these buttons, but the
  // check has to live here to actually be a permission.
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  return NextResponse.json({ ok: await deleteMasterItem(params.id) });
}
