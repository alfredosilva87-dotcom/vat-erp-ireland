import { NextRequest, NextResponse } from "next/server";
import { listSupplierRules, createSupplierRule } from "@/lib/supplierRulesStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ rules: await listSupplierRules(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { rule, error } = await createSupplierRule(params.id, await req.json().catch(() => ({})));
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ rule });
}
