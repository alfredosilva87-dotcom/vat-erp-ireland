import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { baixarDocumento, apagarDocumento } from "@/lib/fiscal/cofre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Descarrega o ficheiro. O `docId` sozinho não basta: o cliente entra na busca. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const doc = await baixarDocumento(params.id, params.docId);
  if (!doc) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });

  return new NextResponse(doc.bytes as any, {
    headers: {
      "Content-Type": doc.mime,
      // `inline` SÓ para o PDF e a imagem: quem confere quer ver, não
      // descarregar. Qualquer outra coisa vai como anexo — renderizada na
      // origem do ERP, seria script a correr com a sessão de quem a abriu.
      "Content-Disposition":
        `${doc.inline ? "inline" : "attachment"}; filename="${doc.filename.replace(/["\\]/g, "")}"`,
      // Sem isto o navegador adivinha o tipo pelo conteudo e pode render um
      // ficheiro que nós marcámos como octet-stream justamente para não o ser.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const r = await apagarDocumento(params.id, params.docId);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true });
}
