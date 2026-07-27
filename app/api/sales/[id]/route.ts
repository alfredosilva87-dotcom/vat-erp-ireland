import { NextRequest, NextResponse } from "next/server";
import { deleteSalesEntry } from "@/lib/store";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ ok: await deleteSalesEntry(params.id) });
}
