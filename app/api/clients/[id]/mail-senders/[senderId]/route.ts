import { NextRequest, NextResponse } from "next/server";
import { deleteMailSender } from "@/lib/mailStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: { senderId: string } }) {
  return NextResponse.json({ ok: await deleteMailSender(params.senderId) });
}
