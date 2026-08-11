import { NextRequest, NextResponse } from "next/server";
import { deleteMailSender } from "@/lib/mailStore";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; senderId: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  return NextResponse.json({ ok: await deleteMailSender(params.senderId) });
}
