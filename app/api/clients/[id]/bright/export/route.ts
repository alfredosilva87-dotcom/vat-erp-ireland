import { NextRequest, NextResponse } from "next/server";
import { exportData, listSales } from "@/lib/store";
import {
  buildContactsCsv,
  buildPurchaseInvoicesCsv,
  buildJournalCsv,
  filenameFor,
  type BrightExportType,
} from "@/lib/brightExport";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

// GET /api/clients/[id]/bright/export?type=contacts|purchases|journal&year=2026
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const type = (req.nextUrl.searchParams.get("type") || "purchases") as BrightExportType;
  const year = Number(req.nextUrl.searchParams.get("year")) || new Date().getFullYear();

  const { client, invoices, items } = await exportData(params.id, year);

  let csv: string;
  if (type === "contacts") {
    const sales = await listSales(params.id);
    csv = buildContactsCsv(invoices, sales);
  } else if (type === "journal") {
    csv = buildJournalCsv(invoices, items);
  } else {
    csv = buildPurchaseInvoicesCsv(invoices, items);
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameFor(type, client, year)}"`,
    },
  });
}
