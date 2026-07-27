import { NextRequest, NextResponse } from "next/server";
import { getObligations, refreshObligations, monthlySeries } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sp = new URL(req.url).searchParams;
  const year = Number(sp.get("year")) || new Date().getFullYear();
  const obligations = sp.get("refresh") === "1"
    ? await refreshObligations(params.id, year)
    : await getObligations(params.id, year);
  return NextResponse.json({ obligations, series: await monthlySeries(params.id, year), year });
}
