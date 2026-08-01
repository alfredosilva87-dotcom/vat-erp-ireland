import { NextRequest, NextResponse } from "next/server";
import { exportData, clientDashboard } from "@/lib/store";
import { buildClientWorkbook } from "@/lib/exportExcel";

export const runtime = "nodejs";
export const maxDuration = 60;

// Serves the styled workbook directly as a download, so the browser never has
// to build (or style) the file itself.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const year = Number(req.nextUrl.searchParams.get("year")) || new Date().getFullYear();

  const [data, dash] = await Promise.all([
    exportData(params.id, year),
    clientDashboard(params.id, year),
  ]);
  if (!data.client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const buffer = await buildClientWorkbook({
    client: data.client,
    year,
    kpis: dash.kpis,
    series: dash.series,
    rates: data.rates,
    obligations: data.obligations,
    invoices: data.invoices,
    items: data.items,
  });

  const safeName = (data.client.name || "client").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const filename = `vat-report_${safeName}_${year}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
