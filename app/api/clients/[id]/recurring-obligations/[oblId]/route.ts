import { NextRequest, NextResponse } from "next/server";
import { updateRecurringObligation, deleteRecurringObligation } from "@/lib/store";
import { denied, requireRecurringObligation } from "@/lib/access";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string; oblId: string } }) {
  const access = await requireRecurringObligation(params.oblId);
  if (denied(access)) return access.error;

  const body = await req.json();
  const obligation = await updateRecurringObligation(params.oblId, body || {});
  return NextResponse.json({ obligation });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; oblId: string } }) {
  const access = await requireRecurringObligation(params.oblId);
  if (denied(access)) return access.error;

  const ok = await deleteRecurringObligation(params.oblId);
  return NextResponse.json({ ok });
}
