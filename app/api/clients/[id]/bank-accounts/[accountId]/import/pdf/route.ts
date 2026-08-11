import { NextRequest, NextResponse } from "next/server";
import { getBankAccount } from "@/lib/bankStore";
import { extractPdfText } from "@/lib/extractor/pdfNative";
import { extractPdfLines } from "@/lib/extractor/pdfLayout";
import { pdfTextToRows, pdfLinesToRows } from "@/lib/pdfStatement";
import { statementRowsFromMedia } from "@/lib/extractor/gemini";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Extrato de um trimestre inteiro passa fácil de um minuto no caminho de IA.
export const maxDuration = 300;

type Ctx = { params: { id: string; accountId: string } };

/**
 * Turns a PDF statement into the same grid of cells a CSV would produce.
 *
 * Três caminhos, nesta ordem, e a ordem importa:
 *
 *   1. **Posição na página** (`extractPdfLines` + `pdfLinesToRows`). É o único
 *      que separa saída de entrada com segurança, porque num extrato de verdade
 *      — o do AIB, por exemplo — o texto sai colado
 *      (`14 Jul 2026VDP-PREMIER LOTTER10.00412.80`) e só a coluna diz o que é
 *      cada número.
 *   2. **Texto corrido**, para PDF cujo layout não expõe cabeçalho de colunas.
 *   3. **Leitura por IA**, só quando não há camada de texto (extrato
 *      escaneado). Custa, erra e não é reproduzível, então é último recurso e
 *      volta marcado como tal.
 *
 * O que sai daqui vai para a MESMA tela de confirmação do CSV, com o mesmo
 * mapeamento de colunas e a mesma conferência contra o saldo. PDF não ganha
 * atalho para gravar sem alguém olhar.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const account = await getBankAccount(params.accountId);
  if (!account || account.client_id !== params.id) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie o arquivo PDF." }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "PDF maior que 20 MB." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const positioned = await extractPdfLines(buffer);
  if (positioned.length) {
    const byColumn = pdfLinesToRows(positioned);
    if (byColumn.rows.length) {
      return NextResponse.json({ ...byColumn, source: "layout" });
    }
  }

  const text = await extractPdfText(buffer);

  if (text) {
    const result = pdfTextToRows(text);
    if (result.rows.length) {
      return NextResponse.json({ ...result, source: "text" });
    }
    // Tem texto, mas nada que pareça movimento: pode ser um extrato com layout
    // que o leitor não reconhece. A IA ainda pode dar conta.
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({
      error: text
        ? "Não reconheci nenhum movimento neste PDF. Se o banco oferecer CSV ou Excel, prefira — é mais confiável."
        : "Este PDF não tem texto (parece escaneado) e a leitura por IA não está configurada nesta instalação.",
    }, { status: 422 });
  }

  try {
    const lines = await statementRowsFromMedia(buffer.toString("base64"), "application/pdf");
    if (!lines.length) {
      return NextResponse.json(
        { error: "Não consegui ler movimentos deste PDF. Se o banco oferecer CSV ou Excel, prefira." },
        { status: 422 }
      );
    }
    return NextResponse.json({
      rows: lines.map((l) => [l.date, l.description, l.amount, l.balance]),
      notes: [
        "PDF sem texto: lido por IA. Confira linha a linha antes de gravar — esta leitura não é conferível como a de um arquivo com texto.",
      ],
      signFromBalance: false,
      ignored: 0,
      source: "ai",
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "A leitura por IA falhou: " + (e?.message || "erro desconhecido") },
      { status: 502 }
    );
  }
}
