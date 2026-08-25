import { NextRequest, NextResponse } from "next/server";
import { structureSalesSheet } from "@/lib/extractor/gemini";
import { fillSheetSale } from "@/lib/extractor/salesSheet";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
// Uma foto de planilha cheia é uma chamada de visão longa; o padrão de 10s
// cortaria a leitura no meio e devolveria erro numa folha que ia entrar.
export const maxDuration = 120;

/**
 * Lê uma foto/PDF de PLANILHA de vendas e devolve as linhas — sem gravar.
 *
 * Não grava de propósito: a leitura de uma folha manuscrita erra mais que a de
 * uma nota impressa, e no lado da venda o erro SOBE o IVA a pagar. As linhas
 * voltam para a grade da tela, onde o contador confere e corrige antes de
 * mandar gravar pelo caminho normal de vendas.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Envie um arquivo." }, { status: 400 });
  }

  const accepted = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
  const mime = file.type || "application/octet-stream";
  if (!accepted.includes(mime)) {
    return NextResponse.json({ error: `Tipo não aceito: ${mime}. Envie PDF ou imagem.` }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const rows = (await structureSalesSheet(bytes.toString("base64"), mime)).map(fillSheetSale);
    return NextResponse.json({ rows, count: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha ao ler a planilha." }, { status: 502 });
  }
}
