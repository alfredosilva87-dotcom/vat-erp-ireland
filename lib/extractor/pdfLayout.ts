/**
 * Lê um PDF preservando ONDE cada pedaço de texto está na página.
 *
 * O texto corrido de um PDF joga fora a única informação que resolve um
 * extrato bancário: a coluna. Num extrato real do AIB, a linha sai assim —
 *
 *     14 Jul 2026VDP-PREMIER LOTTER10.00412.80
 *
 * — sem um espaço sequer entre data, descrição, valor e saldo. Não há
 * heurística de texto que separe isso com segurança, e "10.00" pode ser saída
 * ou entrada dependendo apenas de estar 40 pontos mais à esquerda ou à direita.
 *
 * Com as coordenadas, a mesma linha vira uma tabela de verdade, **com as
 * células vazias no lugar** — que é justamente o que distingue débito de
 * crédito.
 */

export interface PdfCell {
  text: string;
  /** Borda esquerda, em pontos da página. */
  x: number;
  /** Borda direita. Números são alinhados à direita, então é esta que importa. */
  right: number;
}

export interface PdfLine {
  page: number;
  /** Altura na página; cai conforme se desce. */
  y: number;
  cells: PdfCell[];
}

function nodeRequire(name: string): any {
  // eslint-disable-next-line no-eval
  return eval("require")(name);
}

/** Duas peças de texto na mesma altura, a menos deste desvio, são a mesma linha. */
const SAME_LINE = 2.2;
/** Peças mais próximas que isto são a mesma célula ("422" + ".80"). */
const SAME_CELL = 1.6;

export async function extractPdfLines(buffer: Buffer): Promise<PdfLine[]> {
  try {
    const pdfParse = nodeRequire("pdf-parse");
    const bytes = new Uint8Array(buffer.length);
    bytes.set(buffer);

    const lines: PdfLine[] = [];
    let page = 0;

    await pdfParse(bytes, {
      pagerender: async (p: any) => {
        page++;
        const content = await p.getTextContent({
          normalizeWhitespace: false,
          // Sem isto o pdf.js junta pedaços vizinhos e inventa espaços — e é
          // exatamente a separação entre colunas que se perde.
          disableCombineTextItems: true,
        });

        const items = (content.items || [])
          .map((i: any) => ({
            text: String(i.str ?? ""),
            x: i.transform[4] as number,
            y: i.transform[5] as number,
            w: (i.width as number) || 0,
          }))
          .filter((i: any) => i.text.trim().length);

        items.sort((a: any, b: any) => b.y - a.y || a.x - b.x);

        let current: { y: number; parts: any[] } | null = null;
        const flush = () => {
          if (!current) return;
          lines.push({ page, y: current.y, cells: mergeCells(current.parts) });
          current = null;
        };

        for (const it of items) {
          if (!current || Math.abs(it.y - current.y) > SAME_LINE) {
            flush();
            current = { y: it.y, parts: [] };
          }
          current.parts.push(it);
        }
        flush();

        return ""; // o texto corrido não interessa aqui
      },
    });

    return lines;
  } catch (e) {
    console.error("[pdfLayout] leitura posicional falhou:", (e as any)?.message);
    return [];
  }
}

function mergeCells(parts: Array<{ text: string; x: number; w: number }>): PdfCell[] {
  const sorted = [...parts].sort((a, b) => a.x - b.x);
  const out: PdfCell[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p.x - last.right <= SAME_CELL) {
      last.text += p.text;
      last.right = Math.max(last.right, p.x + p.w);
    } else {
      out.push({ text: p.text, x: p.x, right: p.x + p.w });
    }
  }
  return out.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text.length);
}
