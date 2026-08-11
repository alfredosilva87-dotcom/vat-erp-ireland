import { NextRequest, NextResponse } from "next/server";
import { vatByRate } from "@/lib/store";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const sp = req.nextUrl.searchParams;
  const start = sp.get("start");
  const end = sp.get("end");
  if (!start || !end) return NextResponse.json({ error: "start and end are required (YYYY-MM-DD)." }, { status: 400 });
  const data = await vatByRate(params.id, start, end);
  return NextResponse.json(data);
}
