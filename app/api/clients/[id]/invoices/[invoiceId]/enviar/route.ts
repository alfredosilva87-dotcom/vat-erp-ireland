import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { lerInvoice, emitenteDoCliente, marcarEnviada } from "@/lib/invoicing/service";
import { pdfDaInvoice } from "@/lib/invoicing/pdf";
import { enviarPorEmail } from "@/lib/invoicing/envio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Desenha o PDF e fala com o servidor de correio.
export const maxDuration = 60;

/**
 * Envia a fatura por e-mail, com o PDF anexado.
 *
 * Só faturas EMITIDAS: um rascunho não tem número definitivo e ainda muda de
 * valor, e uma fatura enviada em rascunho é uma fatura que vai ter de ser
 * corrigida com o cliente já a olhar para ela.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; invoiceId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const body = await req.json().catch(() => ({}));
  const para = String(body?.para ?? "").trim();
  if (!para) return NextResponse.json({ error: "Falta o endereço de e-mail." }, { status: 400 });

  const inv = await lerInvoice(params.id, params.invoiceId);
  if (!inv) return NextResponse.json({ error: "Fatura não encontrada." }, { status: 404 });
  if (inv.status === "draft") {
    return NextResponse.json({ error: "Emita a fatura antes de a enviar." }, { status: 409 });
  }
  if (inv.status === "cancelled") {
    return NextResponse.json({ error: "Esta fatura está anulada e não se envia." }, { status: 409 });
  }

  const emitente = await emitenteDoCliente(params.id);
  if (!emitente) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });

  const bytes = await pdfDaInvoice(inv, emitente);
  const assunto = String(body?.assunto ?? "").trim() || `Invoice ${inv.number} — ${emitente.nome}`;
  const corpo = String(body?.corpo ?? "").trim()
    || `Dear ${inv.customerName},\n\nPlease find attached invoice ${inv.number}`
       + `${inv.dueDate ? `, due on ${inv.dueDate}` : ""}.\n\nKind regards,\n${emitente.nome}`;

  const r = await enviarPorEmail({
    para, assunto, corpo,
    anexo: { nome: `${inv.number}.pdf`, bytes },
    // A resposta vai para o cliente e não para o escritório.
    responderA: emitente.linhas.find((l) => l.includes("@")) ?? null,
  });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 502 });

  await marcarEnviada(params.id, params.invoiceId, para);
  return NextResponse.json({ ok: true, para });
}
