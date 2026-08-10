import { NextRequest, NextResponse } from "next/server";
import { listBankRules, createBankRule } from "@/lib/bankRulesStore";
import { findShadowedRules } from "@/lib/bankRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * As regras na ordem em que serão avaliadas, mais o aviso de quais nunca vão
 * acontecer.
 *
 * O aviso vem junto porque o sintoma é mudo: a regra específica está lá,
 * escrita certa, e simplesmente nunca dispara — uma mais ampla acima dela ganha
 * sempre.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const rules = await listBankRules(params.id);
  const shadowed = findShadowedRules(rules).map((s) => ({
    ruleId: s.rule.id,
    shadowedById: s.shadowedBy.id,
    shadowedByName: s.shadowedBy.name,
  }));
  return NextResponse.json({ rules, shadowed });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const rule = await createBankRule(params.id, await req.json().catch(() => ({})));
  if (!rule) return NextResponse.json({ error: "Dê um nome à regra." }, { status: 400 });
  return NextResponse.json({ rule });
}
