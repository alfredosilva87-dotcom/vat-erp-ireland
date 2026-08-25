/**
 * Ler uma PLANILHA DE VENDAS fotografada — a decisão, sem rede.
 *
 * O caso: o cliente do escritório controla as vendas do mês numa planilha (ou
 * num caderno) e fotografa a folha inteira. Isso não é "uma nota com várias
 * linhas": é uma LISTA DE VENDAS, cada linha com data, cliente e valor
 * próprios — coisas que o extrator de nota não tem onde guardar, porque o item
 * de uma nota não carrega data nem cliente.
 *
 * Por isso instrução e formato próprios. Tentar espremer isso no leitor de
 * nota daria uma venda só, com o total errado e a data de uma linha qualquer.
 */

/** Uma linha da planilha, já normalizada. */
export interface SheetSale {
  entry_date: string | null;   // yyyy-mm-dd
  doc_number: string | null;
  customer: string | null;
  net_amount: number | null;
  vat_rate: number | null;
  vat_amount: number | null;
}

export const SALES_SHEET_INSTRUCTION = `You are reading a SALES LIST for an Irish business — a spreadsheet, ledger page, or handwritten table photographed by the client. Each ROW is a separate sale.

Return STRICT JSON only:
{"sales":[{"date":string|null,"doc_number":string|null,"customer":string|null,"net":number|null,"vat_rate":number|null,"vat":number|null}]}

Rules:
- ONE object per data row. Ignore header rows, totals rows, and subtotal rows — a totals row is not a sale.
- "date" in ISO yyyy-mm-dd. If the sheet uses dd/mm/yyyy, convert it (Irish format: day first).
- Numbers plain, dot as decimal separator, no currency symbols.
- "vat_rate" is the percentage (23, 13.5, 9, 4.8, 0), not the amount.
- If a row shows only a gross total with no net/VAT split, put it in "net" and leave "vat" null — do NOT invent the split.
- Read EVERY data row you can see, even if the image is imperfect. Use null for a cell you cannot read; never guess a value.
- Output ONLY the JSON object.`;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v).trim() || null;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normaliza a resposta do modelo.
 *
 * Data fora do ISO vira `null` em vez de entrar torta: venda com data
 * inventada cai no período errado e desloca o VAT3 de dois trimestres ao mesmo
 * tempo — o do certo, que fica faltando, e o do errado, que fica sobrando.
 */
export function coerceSalesSheet(input: unknown): SheetSale[] {
  let obj: any = input;
  if (typeof input === "string") {
    try { obj = JSON.parse(input); } catch {
      throw new Error("Não foi possível ler esta planilha (resposta da IA não veio em formato válido).");
    }
  }
  const rows = Array.isArray(obj?.sales) ? obj.sales : [];
  return rows
    .map((r: any): SheetSale => {
      const d = str(r?.date);
      return {
        entry_date: d && ISO.test(d) ? d : null,
        doc_number: str(r?.doc_number),
        customer: str(r?.customer),
        net_amount: num(r?.net),
        vat_rate: num(r?.vat_rate),
        vat_amount: num(r?.vat),
      };
    })
    // Linha sem NENHUM valor não é venda — é sobra de cabeçalho ou linha em
    // branco que o modelo devolveu por simetria.
    .filter((r: SheetSale) => r.net_amount != null || r.vat_amount != null);
}

/**
 * Completa o que dá para completar, sem inventar.
 *
 * Só o IVA a partir de líquido × alíquota, que é aritmética do próprio
 * documento. O contrário (deduzir a alíquota de IVA/líquido) é que seria
 * chute, porque um arredondamento de centavo vira 22,97% e não bate com taxa
 * nenhuma da Revenue.
 */
export function fillSheetSale(r: SheetSale): SheetSale {
  if (r.vat_amount == null && r.net_amount != null && r.vat_rate != null) {
    return { ...r, vat_amount: Math.round((r.net_amount * r.vat_rate) / 100 * 100) / 100 };
  }
  return r;
}
