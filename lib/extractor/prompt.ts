import type { RawExtraction, RawItem } from "@/lib/types";

// Instruction shared by every engine so the structured output is identical
// regardless of whether we read a native PDF, an image, or OCR text.
export const EXTRACTION_INSTRUCTION = `You are a precise invoice/receipt parser for IRISH (Ireland) VAT documents.
Extract the data EXACTLY as printed. Do not invent values. Use null when a field is absent.

Return STRICT JSON with this shape:
{
  "doc_kind": "invoice"|"receipt"|"sales_sheet"|"illegible"|"not_a_document",
  "doc_kind_reason": string|null,
  "supplier_name": string|null,
  "store_name": string|null,             // branch/store name printed under the main name (e.g. "Shrewsbury")
  "supplier_vat": string|null,          // Irish VAT number if present (e.g. IE1234567X)
  "invoice_number": string|null,
  "barcode": string|null,                // long barcode / transaction reference number if printed
  "invoice_date": string|null,          // ISO format yyyy-mm-dd
  "invoice_time": string|null,          // HH:MM (24h) if printed, else null
  "doc_type": "invoice"|"receipt"|"other",
  "total_net": number|null,             // net total in EUR
  "total_vat": number|null,             // total VAT in EUR
  "total_gross": number|null,           // gross total in EUR
  "items": [
    {
      "description": string,            // line item text as printed
      "quantity": number|null,
      "unit_price": number|null,
      "net_amount": number|null,        // line net amount in EUR
      "vat_rate_on_invoice": number|null,   // e.g. 23, 13.5, 9, 4.8, 0  (null if the doc does not show a per-line rate)
      "vat_amount_on_invoice": number|null  // line VAT in EUR (null if not shown)
    }
  ]
}

Classify FIRST, in "doc_kind":
- "invoice"        — a supplier invoice or bill.
- "receipt"        — a till/POS receipt.
- "sales_sheet"    — a spreadsheet, ledger page or table listing SEVERAL sales/transactions (rows with their own dates), not a single document.
- "illegible"      — it IS a fiscal document but you cannot read the amounts (blurred, cut off, too dark).
- "not_a_document" — it is NOT a fiscal document at all (a selfie, a random photo, a blank page, a screenshot of something else).
Put a SHORT reason in "doc_kind_reason" for "illegible" and "not_a_document"; null otherwise.
For "illegible" and "not_a_document", still return the JSON shape with nulls and an empty items array — do NOT invent values to fill it.

Rules:
- Many supermarket receipts (e.g. Tesco, Lidl, Dunnes) DO NOT show a VAT rate per line. In that case set vat_rate_on_invoice and vat_amount_on_invoice to null — do NOT guess.
- Numbers must be plain (no currency symbols, dot as decimal separator).
- Keep the original item descriptions; do not translate them.
- Output ONLY the JSON object, nothing else.`;

// Used once per multi-page PDF to decide whether it's a single invoice/receipt
// or a batch of several scanned back-to-back (e.g. a client dropping 40 notes
// into one file), and where each one starts/ends.
export const BOUNDARY_INSTRUCTION = `You are scanning a multi-page PDF that may contain either ONE invoice/receipt, or SEVERAL separate invoices/receipts scanned back-to-back into the same file.
Look at every page. Decide how many distinct invoices/receipts it contains, and which pages belong to each one.
A new invoice/receipt normally starts with a new supplier header/logo, a new invoice number, or a new date/total sequence right after the previous document's total line.

Return STRICT JSON only:
{"documents": [{"page_start": number, "page_end": number}, ...]}

page_start/page_end are 1-indexed and inclusive, in page order, and together must cover every page of the PDF exactly once.
If the whole PDF is a single invoice/receipt (the normal case), return exactly one entry covering page 1 to the last page.`;

// Defensive parse: accept a JSON string (or object) and coerce into RawExtraction.
export function coerceExtraction(input: unknown): RawExtraction {
  let obj: any = input;
  if (typeof input === "string") {
    try {
      obj = JSON.parse(input);
    } catch {
      // A IA devolveu algo que não é JSON válido — resposta cortada, documento
      // ilegível/vazio, ou uma recusa em texto livre. O erro cru do JSON.parse
      // não diz nada disso a quem está revisando; esta mensagem diz.
      throw new Error("Não foi possível ler este documento (resposta da IA não veio em formato válido). Tente ler de novo.");
    }
  }
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  const str = (v: unknown): string | null =>
    v === null || v === undefined ? null : String(v).trim() || null;

  const items: RawItem[] = Array.isArray(obj?.items)
    ? obj.items.map((it: any) => ({
        description: String(it?.description ?? "").trim(),
        quantity: num(it?.quantity),
        unit_price: num(it?.unit_price),
        net_amount: num(it?.net_amount),
        vat_rate_on_invoice: num(it?.vat_rate_on_invoice),
        vat_amount_on_invoice: num(it?.vat_amount_on_invoice),
      })).filter((it: RawItem) => it.description.length > 0)
    : [];

  const docType = ["invoice", "receipt", "other"].includes(obj?.doc_type)
    ? obj.doc_type
    : "invoice";

  /*
   * O que o documento É, decidido pela mesma chamada que lê os valores — sem
   * custo de IA a mais, o que importa num plano com 15 chamadas por minuto.
   *
   * Serve para duas coisas que antes não tinham resposta: separar "leitura
   * fraca" de "isto não é documento" (a foto do dedo, a selfie, a página em
   * branco), e reconhecer a PLANILHA de vendas, que não é uma nota e precisa
   * do outro leitor.
   *
   * Sem valor conhecido cai em "invoice": o padrão tem de ser o caso normal,
   * senão um modelo que devolve a chave errada faria toda nota virar suspeita.
   */
  const KINDS = ["invoice", "receipt", "sales_sheet", "illegible", "not_a_document"];
  const docKind = KINDS.includes(obj?.doc_kind) ? obj.doc_kind : "invoice";

  return {
    doc_kind: docKind,
    doc_kind_reason: str(obj?.doc_kind_reason),
    supplier_name: str(obj?.supplier_name),
    store_name: str(obj?.store_name),
    supplier_vat: str(obj?.supplier_vat),
    invoice_number: str(obj?.invoice_number),
    barcode: str(obj?.barcode),
    invoice_date: str(obj?.invoice_date),
    invoice_time: str(obj?.invoice_time),
    doc_type: docType,
    total_net: num(obj?.total_net),
    total_vat: num(obj?.total_vat),
    total_gross: num(obj?.total_gross),
    items,
  };
}
