import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { getSessionUser, requireRole } from "@/lib/auth";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";

/**
 * "Conferi" numa venda — e o desfazer.
 *
 * Espelha a aprovação da nota de entrada porque a razão é a mesma: numa
 * auditoria, "o sistema leu" e "uma pessoa conferiu" são afirmações
 * diferentes, e só a segunda sustenta o número entregue no VAT3. Por isso
 * grava QUEM e QUANDO, não só um sinalizador.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string; saleId: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const actor = await getSessionUser();
  const { data } = await getServerSupabase()
    .from("sales")
    .update({
      needs_review: false,
      reviewed_at: new Date().toISOString(),
      reviewed_by: actor?.id ?? null,
      reviewed_by_email: actor?.email ?? null,
    })
    .eq("id", params.saleId).eq("client_id", params.id)
    .select().maybeSingle();

  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ sale: data });
}

/**
 * Desfaz a conferência.
 *
 * Só administrador, como do lado da entrada: reabrir apaga o nome de quem
 * assinou, e isso não pode ser gesto de qualquer um.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; saleId: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const { data } = await getServerSupabase()
    .from("sales")
    .update({ needs_review: true, reviewed_at: null, reviewed_by: null, reviewed_by_email: null })
    .eq("id", params.saleId).eq("client_id", params.id)
    .select().maybeSingle();

  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ sale: data });
}
