import { NextRequest, NextResponse } from "next/server";
import { getBankAccount } from "@/lib/bankStore";
import { bulkSpend } from "@/lib/bankReconcile";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; accountId: string } };

/**
 * Conciliação em massa: uma conta contábil por linha, sem documento nenhum.
 *
 * O limite de 200 não é técnico. Lote grande é onde o erro passa despercebido,
 * porque ninguém confere 500 linhas na tela — e um lote errado é caro de
 * desfazer. O plano recomenda ficar abaixo de 100.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const account = await getBankAccount(params.accountId);
  if (!account || account.client_id !== params.id) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items?.length) {
    return NextResponse.json({ error: "Nenhuma linha selecionada." }, { status: 400 });
  }
  if (items.length > 200) {
    return NextResponse.json(
      { error: "Lote grande demais (limite 200). Faça em partes — lote que ninguém confere é lote que esconde erro." },
      { status: 400 }
    );
  }
  // A recusa é explícita para deixar claro que não é esquecimento: casar com
  // documento é a camada A2, e tem que ser feita ANTES do lote.
  if (items.some((i: any) => i?.invoiceId || i?.saleId)) {
    return NextResponse.json(
      { error: "A conciliação em massa não casa com nota nem venda. Concilie os documentos primeiro." },
      { status: 400 }
    );
  }

  const result = await bulkSpend(
    params.accountId, params.id,
    items.map((i: any) => ({
      lineId: String(i?.lineId ?? ""),
      accountCode: i?.accountCode ?? null,
      vatRate: i?.vatRate == null || i.vatRate === "" ? null : Number(i.vatRate),
      description: i?.description ?? null,
      reason: i?.reason === "rule" ? "rule" : "manual",
    })),
    (await getSessionUser())?.id ?? null
  );

  return NextResponse.json(result);
}
