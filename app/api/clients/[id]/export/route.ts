import { NextRequest, NextResponse } from "next/server";
import { exportData } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const year = Number(req.nextUrl.searchParams.get("year")) || new Date().getFullYear();
  const data = await exportData(params.id, year);
  return NextResponse.json(data);
}
