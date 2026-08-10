// Free path: extract embedded text from a native (digital) PDF.
// Returns null when the PDF has no meaningful text layer (i.e. it is scanned).

/**
 * O `require` de verdade do Node, fora do alcance do empacotador.
 *
 * Isto não é preciosismo: com o `import()` que o Next transforma, o pdf.js que
 * vem dentro do pdf-parse recebe os streams corrompidos e devolve
 * "Invalid PDF structure" / "Unknown compression method in flate stream" para
 * PDF que o node puro lê sem reclamar. Como o `catch` abaixo devolve null, a
 * falha era MUDA: todo PDF nativo — extrato e nota fiscal — caía no caminho de
 * IA, que custa dinheiro e não é conferível.
 */
function nodeRequire(name: string): any {
  // eslint-disable-next-line no-eval
  return eval("require")(name);
}

export async function extractPdfText(buffer: Buffer): Promise<string | null> {
  try {
    const pdfParse = nodeRequire("pdf-parse");
    // Cópia com ArrayBuffer próprio: um Buffer do pool do Node começa no meio
    // de um bloco maior, e o pdf.js que vem dentro do pdf-parse lê a partir do
    // início do bloco — daí "Invalid PDF structure" num arquivo perfeito.
    const bytes = new Uint8Array(buffer.length);
    bytes.set(buffer);
    const result = await pdfParse(bytes);
    const text = (result.text || "").trim();
    // Heuristic: a scanned PDF yields little or no extractable text.
    if (text.replace(/\s/g, "").length < 40) return null;
    return text;
  } catch (e) {
    console.error("[pdfNative] leitura de texto falhou:", (e as any)?.message);
    return null;
  }
}
