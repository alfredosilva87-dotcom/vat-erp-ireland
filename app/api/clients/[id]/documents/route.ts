import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { listPeriodDocs, type Lado } from "@/lib/periodDocs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** As notas de entrada e saída do cliente no período pedido. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sp = new URL(req.url).searchParams;
  const hoje = new Date().toISOString().slice(0, 10);
  const de = sp.get("from") || `${hoje.slice(0, 4)}-01-01`;
  const ate = sp.get("to") || hoje;

  const pedido = (sp.get("sides") || "entrada,saida").split(",").filter(Boolean) as Lado[];
  const lados = pedido.filter((l): l is Lado => l === "entrada" || l === "saida");

  const docs = await listPeriodDocs(params.id, de, ate, lados.length ? lados : ["entrada", "saida"]);
  return NextResponse.json({ from: de, to: ate, docs });
}
