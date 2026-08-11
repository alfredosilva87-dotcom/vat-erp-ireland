import { NextRequest, NextResponse } from "next/server";
import { deleteSalesEntry } from "@/lib/store";
import { requireRole } from "@/lib/auth";
import { denied, requireSale } from "@/lib/access";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireSale(params.id);
  if (denied(access)) return access.error;

  // Destructive: administrators only. The UI hides these buttons, but the
  // check has to live here to actually be a permission.
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  return NextResponse.json({ ok: await deleteSalesEntry(params.id) });
}
