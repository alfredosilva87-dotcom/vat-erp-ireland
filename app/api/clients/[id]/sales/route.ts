import { NextRequest, NextResponse } from "next/server";
import { listSales, addSalesEntries } from "@/lib/store";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ sales: await listSales(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const created = await addSalesEntries(params.id, rows);
  return NextResponse.json({ created, count: created.length });
}
