import { NextRequest, NextResponse } from "next/server";
import { listCreditRules, createCreditRule } from "@/lib/store";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ rules: await listCreditRules() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const rule = await createCreditRule(body);
  return NextResponse.json({ rule });
}
