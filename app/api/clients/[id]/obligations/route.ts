import { NextRequest, NextResponse } from "next/server";
import { getObligations, refreshObligations, monthlySeries } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sp = new URL(req.url).searchParams;
  const year = Number(sp.get("year")) || new Date().getFullYear();
  const obligations = sp.get("refresh") === "1"
    ? refreshObligations(params.id, year)
    : getObligations(params.id, year);
  return NextResponse.json({ obligations, series: monthlySeries(params.id, year), year });
}
