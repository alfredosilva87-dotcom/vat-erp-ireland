import { NextRequest, NextResponse } from "next/server";
import { invoicePorToken } from "@/lib/invoicing/envio";
import { lerInvoice, emitenteDoCliente } from "@/lib/invoicing/service";
import { pdfDaInvoice } from "@/lib/invoicing/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A fatura em PDF, para quem tem o endereço.
 *
 * ---------------------------------------------------------------------------
 * PÚBLICA POR DESENHO, E POR QUE ISSO ESTÁ CERTO AQUI
 *
 * Quem recebe uma fatura é o cliente do nosso cliente: não tem conta no ERP,
 * não vai criar uma, e o WhatsApp não aceita anexo por link. Sem esta rota o
 * envio por WhatsApp não existe.
 *
 * O que a torna aceitável, e o que a limita:
 *
 *   - o token são 32 bytes aleatórios, e só nasce quando alguém escolhe
 *     partilhar aquela fatura. Não há endereço adivinhável a partir de outro;
 *   - só serve UMA fatura — a do token. Não dá para andar pelo cliente;
 *   - só faturas emitidas. Rascunho não gera token;
 *   - anular a fatura fecha o link, sem ser preciso lembrar de o revogar;
 *   - e revoga-se à mão a qualquer momento.
 *
 * `noindex` no cabeçalho porque um link partilhado por WhatsApp acaba em
 * pré-visualizações e caches, e uma fatura não tem nada que estar num motor de
 * busca.
 * ---------------------------------------------------------------------------
 */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const alvo = await invoicePorToken(params.token);
  // A MESMA resposta para token inválido, fatura anulada e link revogado: uma
  // mensagem diferente para cada caso diria a quem experimenta tokens qual
  // deles chegou a existir.
  if (!alvo) return new NextResponse("Não encontrado.", { status: 404 });

  const inv = await lerInvoice(alvo.clientId, alvo.invoiceId);
  const emitente = await emitenteDoCliente(alvo.clientId);
  if (!inv || !emitente) return new NextResponse("Não encontrado.", { status: 404 });

  const bytes = await pdfDaInvoice(inv, emitente);
  return new NextResponse(bytes as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${inv.number}.pdf"`,
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Cache-Control": "private, no-store",
    },
  });
}
