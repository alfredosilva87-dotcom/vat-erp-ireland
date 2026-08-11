import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listInvoiceDocuments, mergeDocument } from "@/lib/reviewStore";
import { denied, requireInvoice } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACCEPTED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireInvoice(params.id);
  if (denied(access)) return access.error;

  return NextResponse.json({ documents: await listInvoiceDocuments(params.id) });
}

/**
 * Junta o documento de uma duplicata a esta nota.
 *
 * Nada do lançamento muda — nem valor, nem crédito. Só entra um documento a
 * mais: se os números dos dois divergem, isso é decisão do contador na tela, não
 * uma média para o sistema fazer sozinho.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireInvoice(params.id);
  if (denied(access)) return access.error;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
  }
  const mime = file.type || "application/octet-stream";
  if (!ACCEPTED.includes(mime)) {
    return NextResponse.json({ error: `Tipo não aceito (${mime}).` }, { status: 415 });
  }

  const out = await mergeDocument({
    invoiceId: params.id,
    bytes: Buffer.from(await file.arrayBuffer()),
    filename: file.name || "documento",
    mimeType: mime,
    note: (form.get("note") as string) || null,
  }, await getSessionUser());

  if (out.kind === "error") return NextResponse.json({ error: out.error }, { status: 400 });
  return NextResponse.json({ document: out.document });
}
