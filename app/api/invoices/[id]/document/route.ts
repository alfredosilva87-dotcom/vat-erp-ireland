import { NextRequest, NextResponse } from "next/server";
import { getDocumentDownload } from "@/lib/store";
import { denied, requireInvoice } from "@/lib/access";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireInvoice(params.id);
  if (denied(access)) return access.error;

  const doc = await getDocumentDownload(params.id);

  if (doc.kind === "none") {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  // The file service is not answering — commonly the few seconds after the
  // server reboots. 503 (not 404) so the caller knows the document still
  // exists and it is worth trying again.
  if (doc.kind === "unavailable") {
    return NextResponse.json(
      { error: "The document store is not available right now. Try again in a moment." },
      { status: 503, headers: { "Retry-After": "10" } }
    );
  }

  return new NextResponse(new Uint8Array(doc.bytes), {
    status: 200,
    headers: {
      "Content-Type": MIME[doc.ext] || "application/octet-stream",
      "Content-Disposition": `inline; filename="document.${doc.ext}"`,
    },
  });
}
