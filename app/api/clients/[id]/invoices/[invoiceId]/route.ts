import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { lerInvoice, guardarRascunho, apagarRascunho, anularInvoice } from "@/lib/invoicing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string; invoiceId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const inv = await lerInvoice(params.id, params.invoiceId);
  if (!inv) return NextResponse.json({ error: "Fatura não encontrada." }, { status: 404 });
  return NextResponse.json({ invoice: inv });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; invoiceId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const r = await guardarRascunho(params.id, params.invoiceId, await req.json());
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ id: r.id });
}

/**
 * Apaga o rascunho, ou ANULA a emitida.
 *
 * O mesmo verbo para as duas porque para quem clica o gesto é o mesmo — "tirar
 * esta fatura da frente". O que muda é o efeito, e é o servidor que decide qual
 * conforme o estado: um rascunho desaparece, uma emitida fica anulada com o
 * número preservado. Deixar a tela escolher abriria a porta a apagar uma fatura
 * emitida por engano.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; invoiceId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const inv = await lerInvoice(params.id, params.invoiceId);
  if (!inv) return NextResponse.json({ error: "Fatura não encontrada." }, { status: 404 });

  const r = inv.status === "draft"
    ? await apagarRascunho(params.id, params.invoiceId)
    : await anularInvoice(params.id, params.invoiceId);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 409 });
  return NextResponse.json({ ok: true, acao: inv.status === "draft" ? "apagado" : "anulado" });
}
