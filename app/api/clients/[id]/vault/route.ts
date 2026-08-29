import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { listarDocumentos, guardarDocumento } from "@/lib/fiscal/cofre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O cofre de documentos do cliente — ver `lib/fiscal/cofre.ts`.
 *
 * `requireClient` é o que separa este cofre de uma pasta partilhada: quem não
 * tem o cliente atribuído não lista nem grava, e isso vale para documentos de
 * identidade, que são exatamente os que não podem circular.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  return NextResponse.json({ documentos: await listarDocumentos(params.id) });
}

/** Limite por ficheiro. Um comprovativo de morada não chega perto disto. */
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Escolha um ficheiro." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `O ficheiro tem ${(file.size / 1024 / 1024).toFixed(1)} MB. O limite é 15 MB.` },
      { status: 400 }
    );
  }

  const texto = (chave: string) => {
    const v = form.get(chave);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  const r = await guardarDocumento({
    clientId: params.id,
    kind: texto("kind") || "other",
    title: texto("title"),
    bytes: Buffer.from(await file.arrayBuffer()),
    originalFilename: file.name || "documento",
    mimeType: file.type || "application/octet-stream",
    issuedOn: texto("issuedOn"),
    expiresOn: texto("expiresOn"),
    notes: texto("notes"),
    // Quem carregou fica gravado: um documento de identidade que aparece
    // sem se saber quem o pos la e um problema de auditoria por si so.
    userId: (await getSessionUser())?.id ?? null,
  });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 500 });
  return NextResponse.json({ id: r.id, documentos: await listarDocumentos(params.id) });
}
