import { NextRequest, NextResponse } from "next/server";
import { updateBankRule, deleteBankRule, moveBankRule } from "@/lib/bankRulesStore";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; ruleId: string } };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const body = await req.json().catch(() => ({}));

  // Mover é um caso à parte: trocar prioridade com a vizinha, não escrever um
  // número que o usuário teria de calcular.
  if (body?.move === "up" || body?.move === "down") {
    const moved = await moveBankRule(params.id, params.ruleId, body.move);
    if (!moved.ok) return NextResponse.json({ error: moved.error }, { status: 404 });
    return NextResponse.json(moved);
  }

  const rule = await updateBankRule(params.ruleId, body);
  if (!rule) return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  return NextResponse.json({ rule });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  return NextResponse.json({ ok: await deleteBankRule(params.ruleId) });
}
