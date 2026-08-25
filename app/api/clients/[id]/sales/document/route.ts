import { NextRequest, NextResponse } from "next/server";
import { saveSaleFromDocument, type SaleDocPayload } from "@/lib/store";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";

/**
 * Grava uma venda LIDA DE DOCUMENTO, guardando o arquivo.
 *
 * Rota própria (e não a de vendas em lote) porque só aqui existe arquivo: a
 * outra recebe JSON de digitação/planilha. Multipart pelo mesmo motivo de
 * `/api/invoices` — o documento viaja junto com o cabeçalho, numa volta só,
 * senão daria para gravar a venda e perder a imagem no meio.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const form = await req.formData();
  const metaRaw = form.get("meta");
  if (typeof metaRaw !== "string") {
    return NextResponse.json({ error: "Missing meta payload." }, { status: 400 });
  }
  const payload = JSON.parse(metaRaw) as SaleDocPayload;
  if (!payload?.entry_date) {
    // Sem data a venda não cai em período nenhum, então não entraria no VAT3 —
    // e some da apuração sem ninguém notar. Melhor recusar e dizer.
    return NextResponse.json({ error: "A venda precisa de uma data." }, { status: 400 });
  }

  const file = form.get("file");
  let buffer: Buffer | null = null;
  let ext = "bin";
  if (file && typeof file !== "string") {
    buffer = Buffer.from(await file.arrayBuffer());
    ext = (file.name.split(".").pop() || "bin").toLowerCase();
  }

  const sale = await saveSaleFromDocument(params.id, payload, buffer, ext);
  if (!sale) return NextResponse.json({ error: "A venda precisa de uma data." }, { status: 400 });
  return NextResponse.json({ sale });
}
