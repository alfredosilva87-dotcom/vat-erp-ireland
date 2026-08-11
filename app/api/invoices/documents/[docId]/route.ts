import { NextRequest, NextResponse } from "next/server";
import { downloadInvoiceDocument } from "@/lib/reviewStore";
import { denied, requireInvoiceDocument } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Um documento extra da nota (camada B3), para abrir lado a lado com o principal. */
export async function GET(_req: NextRequest, { params }: { params: { docId: string } }) {
  const access = await requireInvoiceDocument(params.docId);
  if (denied(access)) return access.error;

  const doc = await downloadInvoiceDocument(params.docId);
  if (!doc) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  return new NextResponse(new Uint8Array(doc.bytes), {
    status: 200,
    headers: {
      "Content-Type": doc.mime,
      "Content-Disposition": `inline; filename="${doc.filename.replace(/"/g, "")}"`,
    },
  });
}
