import { NextRequest, NextResponse } from "next/server";
import { exportData } from "@/lib/store";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const year = Number(req.nextUrl.searchParams.get("year")) || new Date().getFullYear();
  const data = await exportData(params.id, year);
  return NextResponse.json(data);
}
