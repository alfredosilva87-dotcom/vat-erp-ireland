import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { listSaleItems, deleteSalesEntry } from "@/lib/store";
import { denied, requireClient } from "@/lib/access";
import { requireRole } from "@/lib/auth";
import { rastroDoDocumento } from "@/lib/financial/trace";
import { impedimentoParaEditar } from "@/lib/financial/devolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Uma venda com as linhas dela, para a tela de revisão. */
export async function GET(_req: NextRequest, { params }: { params: { id: string; saleId: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const { data: sale } = await getServerSupabase()
    .from("sales").select("*").eq("id", params.saleId).eq("client_id", params.id).maybeSingle();
  if (!sale) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // O rastro — ver lib/financial/trace.ts. Do lado da venda a pergunta e a
  // mesma: esta venda virou conta a receber, e qual?
  const [items, integration] = await Promise.all([
    listSaleItems(params.saleId),
    rastroDoDocumento(params.id, params.saleId, "sale"),
  ]);
  return NextResponse.json({ sale, items, integration });
}

/**
 * Corrige a venda conferida.
 *
 * O IVA do cabeçalho é recalculado aqui quando líquido e alíquota vêm juntos:
 * o número que vai para o VAT3 não pode sair da tela, senão uma conta feita no
 * navegador com arredondamento diferente entra como verdade na apuração.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; saleId: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const body = await req.json();
  const row: any = {};
  for (const k of ["entry_date", "doc_number", "customer", "net_amount", "vat_rate", "notes"]) {
    if (k in body) row[k] = body[k];
  }
  if ("needs_review" in body) row.needs_review = !!body.needs_review;

  const sb = getServerSupabase();
  const { data: current } = await sb
    .from("sales").select("*").eq("id", params.saleId).eq("client_id", params.id).maybeSingle();
  if (!current) return NextResponse.json({ error: "Not found." }, { status: 404 });

  /*
   * Num documento integrado, valor e data nao se mexem — mesma razao da nota
   * de compra, ver `impedimentoParaEditar`. So os campos que MUDAM de facto
   * contam: reenviar o mesmo numero nao e alteracao.
   */
  const mudam = Object.keys(row).filter((k) => {
    const antes = (current as any)[k];
    const depois = (row as any)[k];
    if (antes == null && depois == null) return false;
    return Number.isFinite(Number(antes)) && Number.isFinite(Number(depois))
      ? Number(antes) !== Number(depois)
      : String(antes ?? "") !== String(depois ?? "");
  });
  if (mudam.length) {
    const impedimento = await impedimentoParaEditar(params.id, params.saleId, "sale", mudam);
    if (impedimento) return NextResponse.json({ error: impedimento }, { status: 409 });
  }

  const net = row.net_amount ?? current.net_amount;
  const rate = row.vat_rate ?? current.vat_rate;
  if ("vat_amount" in body && body.vat_amount != null) {
    // Valor digitado à mão manda: documento com IVA impresso que não bate com
    // líquido × alíquota (arredondamento do emissor) tem de poder ser copiado
    // como está.
    row.vat_amount = Number(Number(body.vat_amount).toFixed(2));
  } else if (net != null && rate != null) {
    row.vat_amount = Number(((net * rate) / 100).toFixed(2));
  }

  const { data } = await sb.from("sales").update(row).eq("id", params.saleId).select().maybeSingle();
  return NextResponse.json({ sale: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; saleId: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  // Destrutivo: só administrador, como a exclusão de nota de entrada.
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const r = await deleteSalesEntry(params.saleId);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 409 });
  return NextResponse.json({ ok: true });
}
