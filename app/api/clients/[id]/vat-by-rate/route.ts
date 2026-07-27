import { NextRequest, NextResponse } from "next/server";
import { vatByRate } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sp = req.nextUrl.searchParams;
  const start = sp.get("start");
  const end = sp.get("end");
  if (!start || !end) return NextResponse.json({ error: "start and end are required (YYYY-MM-DD)." }, { status: 400 });
  const data = await vatByRate(params.id, start, end);
  return NextResponse.json(data);
}
