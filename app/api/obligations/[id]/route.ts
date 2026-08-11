import { NextRequest, NextResponse } from "next/server";
import { updateObligation } from "@/lib/store";
import { denied, requireObligation } from "@/lib/access";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireObligation(params.id);
  if (denied(access)) return access.error;

  const patch = await req.json();
  const o = await updateObligation(params.id, patch);
  if (!o) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ obligation: o });
}
