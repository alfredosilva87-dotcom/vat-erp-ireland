import { NextRequest, NextResponse } from "next/server";
import { listSales, addSalesEntries } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ sales: listSales(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const created = addSalesEntries(params.id, rows);
  return NextResponse.json({ created, count: created.length });
}
