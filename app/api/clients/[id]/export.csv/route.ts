import { NextRequest, NextResponse } from "next/server";
import { exportData, clientDashboard, ALL_EXPORT_SETS, type ExportSet } from "@/lib/store";
import { buildClientCsvs } from "@/lib/exportCsv";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function readParams(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get("year")) || new Date().getFullYear();
  const start = sp.get("start") || `${year}-01-01`;
  const end = sp.get("end") || `${year}-12-31`;
  const raw = (sp.get("sets") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const sets = raw.filter((s): s is ExportSet => (ALL_EXPORT_SETS as string[]).includes(s));
  return { year, start, end, sets: sets.length ? sets : ALL_EXPORT_SETS };
}

// One dataset -> a plain .csv download. Several datasets -> the files are
// concatenated with a header line naming each, so the user still gets a single
// file without pulling in a zip dependency.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const { year, start, end, sets } = readParams(req);

  const [data, dash] = await Promise.all([
    exportData(params.id, year, { start, end, sets }),
    clientDashboard(params.id, year),
  ]);
  if (!data.client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const files = buildClientCsvs({
    client: data.client, start, end, sets,
    invoices: data.invoices, items: data.items, sales: data.sales,
    accounts: data.accounts, obligations: data.obligations, rates: data.rates,
    kpis: dash.kpis,
  });

  if (!files.length) return NextResponse.json({ error: "Nothing selected to export." }, { status: 400 });

  const single = files.length === 1;
  const body = single
    ? files[0].content
    : files.map((f) => `### ${f.name}\r\n${f.content}`).join("\r\n\r\n");

  const safeName = (data.client.name || "client").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const filename = single ? files[0].name : `vat-export_${safeName}_${start}_${end}.csv`;

  // BOM so Excel opens accented characters correctly on Windows.
  return new NextResponse("﻿" + body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
