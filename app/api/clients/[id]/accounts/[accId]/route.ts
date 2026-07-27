import { NextRequest, NextResponse } from "next/server";
import { updateAccount, deleteAccount } from "@/lib/store";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { accId: string } }) {
  const body = await req.json();
  const account = await updateAccount(params.accId, body || {});
  return NextResponse.json({ account });
}

export async function DELETE(_req: NextRequest, { params }: { params: { accId: string } }) {
  const ok = await deleteAccount(params.accId);
  return NextResponse.json({ ok });
}
