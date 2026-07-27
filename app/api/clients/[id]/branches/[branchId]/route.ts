import { NextRequest, NextResponse } from "next/server";
import { updateBranch, deleteBranch } from "@/lib/store";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { branchId: string } }) {
  const body = await req.json();
  const branch = await updateBranch(params.branchId, body || {});
  return NextResponse.json({ branch });
}

export async function DELETE(_req: NextRequest, { params }: { params: { branchId: string } }) {
  const ok = await deleteBranch(params.branchId);
  return NextResponse.json({ ok });
}
