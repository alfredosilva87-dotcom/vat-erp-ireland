import { NextRequest, NextResponse } from "next/server";
import { updateObligation } from "@/lib/store";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const patch = await req.json();
  const o = updateObligation(params.id, patch);
  if (!o) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ obligation: o });
}
