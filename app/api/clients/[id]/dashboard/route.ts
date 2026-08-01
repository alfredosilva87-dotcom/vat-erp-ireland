import { NextRequest, NextResponse } from "next/server";
import { clientDashboard } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const year = Number(req.nextUrl.searchParams.get("year")) || new Date().getFullYear();
  const data = await clientDashboard(params.id, year);
  if (!data.client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  return NextResponse.json(data);
}
