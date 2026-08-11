import { NextRequest, NextResponse } from "next/server";
import { updateSupplierRule, deleteSupplierRule } from "@/lib/supplierRulesStore";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; ruleId: string } };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const { rule, error } = await updateSupplierRule(params.ruleId, await req.json().catch(() => ({})));
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (!rule) return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  return NextResponse.json({ rule });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  return NextResponse.json({ ok: await deleteSupplierRule(params.ruleId) });
}
