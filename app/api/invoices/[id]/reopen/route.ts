import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { reopenInvoice } from "@/lib/reviewStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Só de administrador, como reabrir um período fechado (camada A5): apagar o
// registro de uma conferência por engano no meio de outro trabalho é o tipo de
// coisa que ninguém percebe até a auditoria.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;
  const body = await req.json().catch(() => ({}));
  const ok = await reopenInvoice(params.id, guard.user, body?.note ?? null);
  if (!ok) return NextResponse.json({ error: "Não foi possível desfazer a aprovação." }, { status: 400 });
  return NextResponse.json({ ok });
}
