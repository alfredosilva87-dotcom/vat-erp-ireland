import { NextRequest, NextResponse } from "next/server";
import { deleteSalesEntry } from "@/lib/store";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  // Destructive: administrators only. The UI hides these buttons, but the
  // check has to live here to actually be a permission.
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  return NextResponse.json({ ok: await deleteSalesEntry(params.id) });
}
