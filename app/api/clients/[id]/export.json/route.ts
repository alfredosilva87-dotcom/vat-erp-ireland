import { NextRequest, NextResponse } from "next/server";
import { exportData, clientDashboard, ALL_EXPORT_SETS, type ExportSet } from "@/lib/store";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Same period/dataset contract as the xlsx and csv routes, but returns raw
// JSON — the PDF is laid out in the browser with jsPDF.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get("year")) || new Date().getFullYear();
  const start = sp.get("start") || `${year}-01-01`;
  const end = sp.get("end") || `${year}-12-31`;
  const raw = (sp.get("sets") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const picked = raw.filter((s): s is ExportSet => (ALL_EXPORT_SETS as string[]).includes(s));
  const sets = picked.length ? picked : ALL_EXPORT_SETS;

  const [data, dash] = await Promise.all([
    exportData(params.id, year, { start, end, sets }),
    clientDashboard(params.id, year),
  ]);
  if (!data.client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  return NextResponse.json({ ...data, kpis: dash.kpis });
}
