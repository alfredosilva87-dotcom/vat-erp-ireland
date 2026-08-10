import { NextResponse } from "next/server";
import { loadBase } from "@/lib/loadBase";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

// GET the current rate base + credit rules (live from Supabase, or bundled).
export async function GET() {
  const { categories, rules, source } = await loadBase();
  return NextResponse.json({ categories, rules, source });
}
