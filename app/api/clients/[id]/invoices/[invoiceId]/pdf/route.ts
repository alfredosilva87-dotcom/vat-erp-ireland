import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { lerInvoice, emitenteDoCliente } from "@/lib/invoicing/service";
import { pdfDaInvoice, nomeDoFicheiro } from "@/lib/invoicing/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Lê a fatura, o cadastro e o logótipo, e desenha o PDF.
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { id: string; invoiceId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const inv = await lerInvoice(params.id, params.invoiceId);
  if (!inv) return NextResponse.json({ error: "Fatura não encontrada." }, { status: 404 });

  const emitente = await emitenteDoCliente(params.id);
  if (!emitente) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });

  const bytes = await pdfDaInvoice(inv, emitente);
  // O nome leva o cliente — ver nomeDoFicheiro em lib/invoicing/pdf.ts.
  const nome = nomeDoFicheiro(inv.number, inv.customerName, inv.status === "draft");

  return new NextResponse(bytes as any, {
    headers: {
      "Content-Type": "application/pdf",
      // Inline por omissão: quem gera uma fatura quer VÊ-LA antes de a enviar.
      "Content-Disposition":
        `${req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${nome}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
