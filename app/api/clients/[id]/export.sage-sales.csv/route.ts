import { NextRequest, NextResponse } from "next/server";
import { exportData } from "@/lib/store";
import { buildSageSalesCsv } from "@/lib/exportSage";

export const runtime = "nodejs";
export const maxDuration = 60;

function readParams(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get("year")) || new Date().getFullYear();
  const start = sp.get("start") || `${year}-01-01`;
  const end = sp.get("end") || `${year}-12-31`;
  return { year, start, end };
}

// Sales-to-Sage is a fixed-purpose format (always the "sales" dataset in the
// Sage 50 Accounts import layout) — the caller only picks the period.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { year, start, end } = readParams(req);
  const data = await exportData(params.id, year, { start, end, sets: ["sales"] });
  if (!data.client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const file = buildSageSalesCsv(data.client, data.sales ?? []);

  return new NextResponse("﻿" + file.content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.name}"`,
      "Cache-Control": "no-store",
    },
  });
}
