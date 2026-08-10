import { NextRequest, NextResponse } from "next/server";
import { exportData, clientDashboard, ALL_EXPORT_SETS, type ExportSet } from "@/lib/store";
import { buildClientWorkbook } from "@/lib/exportExcel";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Reads ?start=&end=&sets= into a validated period + dataset selection. */
function readExportParams(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get("year")) || new Date().getFullYear();
  const start = sp.get("start") || `${year}-01-01`;
  const end = sp.get("end") || `${year}-12-31`;
  const raw = (sp.get("sets") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const sets = raw.filter((s): s is ExportSet => (ALL_EXPORT_SETS as string[]).includes(s));
  return { year, start, end, sets: sets.length ? sets : ALL_EXPORT_SETS };
}

// Serves the styled workbook directly as a download, so the browser never has
// to build (or style) the file itself.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { year, start, end, sets } = readExportParams(req);

  const [data, dash] = await Promise.all([
    exportData(params.id, year, { start, end, sets }),
    clientDashboard(params.id, year),
  ]);
  if (!data.client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const buffer = await buildClientWorkbook({
    client: data.client,
    year, start, end, sets,
    kpis: dash.kpis,
    series: dash.series,
    rates: data.rates,
    invoiceRates: data.invoiceRates,
    obligations: data.obligations,
    invoices: data.invoices,
    items: data.items,
    sales: data.sales,
    accounts: data.accounts,
  });

  const safeName = (data.client.name || "client").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const filename = `vat-report_${safeName}_${start}_${end}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
