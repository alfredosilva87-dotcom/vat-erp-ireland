import type { RawExtraction, RawItem } from "@/lib/types";

// Instruction shared by every engine so the structured output is identical
// regardless of whether we read a native PDF, an image, or OCR text.
export const EXTRACTION_INSTRUCTION = `You are a precise invoice/receipt parser for IRISH (Ireland) VAT documents.
Extract the data EXACTLY as printed. Do not invent values. Use null when a field is absent.

Return STRICT JSON with this shape:
{
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
  const obj = typeof input === "string" ? JSON.parse(input) : (input as any);
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

  return {
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
