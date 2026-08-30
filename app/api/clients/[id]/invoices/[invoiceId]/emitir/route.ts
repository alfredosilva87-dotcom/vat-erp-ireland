import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { emitirInvoice } from "@/lib/invoicing/service";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * EMITE: número definitivo e a venda que liga ao resto do sistema.
 *
 * Ver lib/invoicing/service.ts — a invoice emitida É a venda, e daí o VAT3, o
 * contas a receber e o razão seguem os caminhos que já existem.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string; invoiceId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const r = await emitirInvoice(params.id, params.invoiceId, (await getSessionUser())?.id ?? null);
  if (!r.ok) {
    // Os problemas vão em lista e com o campo: a tela consegue apontar cada um
    // ao sítio onde se corrige, em vez de mostrar um parágrafo de erro.
    if (r.problemas) return NextResponse.json({ error: "A fatura ainda não pode ser emitida.", problemas: r.problemas }, { status: 422 });
    return NextResponse.json({ error: r.erro }, { status: 400 });
  }
  // O aviso sobe junto: a fatura foi emitida, mas se a integraçao tropeçou
  // quem emitiu tem de saber ANTES de a mandar ao cliente.
  return NextResponse.json({ invoice: r.invoice, aviso: r.aviso });
}
