import { NextRequest, NextResponse } from "next/server";
import { updateAccount, deleteAccount } from "@/lib/store";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { accId: string } }) {
  const body = await req.json();
  const account = await updateAccount(params.accId, body || {});
  return NextResponse.json({ account });
}

export async function DELETE(_req: NextRequest, { params }: { params: { accId: string } }) {
  // Destructive: administrators only. The UI hides these buttons, but the
  // check has to live here to actually be a permission.
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const ok = await deleteAccount(params.accId);
  return NextResponse.json({ ok });
}
