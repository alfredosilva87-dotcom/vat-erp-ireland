import { NextRequest, NextResponse } from "next/server";
import { listRecurringObligations, createRecurringObligation } from "@/lib/store";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  return NextResponse.json({ obligations: await listRecurringObligations(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const body = await req.json();
  const obligation = await createRecurringObligation(params.id, body || {});
  if (!obligation) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  return NextResponse.json({ obligation });
}
