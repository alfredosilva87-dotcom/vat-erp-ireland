import { NextRequest, NextResponse } from "next/server";
import { listMasterItems } from "@/lib/store";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get("q") || undefined;
  return NextResponse.json({ items: await listMasterItems(q) });
}
