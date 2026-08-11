/**
 * Ler um documento e gravá-lo como nota — o caminho, num lugar só.
 *
 * Extraído na camada B2 porque passou a existir uma segunda porta de entrada: a
 * fila do e-mail. Duas cópias desta orquestração divergiriam, e o lugar onde
 * elas divergiriam é a montagem do payload de gravação — que é justamente onde
 * mora a conta contábil decidida pela regra de fornecedor (camada B1). Uma cópia
 * esquecida de mandar `account_code` faria a regra parar de funcionar só numa das
 * duas telas, e ninguém ligaria uma coisa à outra.
 *
 * Aqui não há estado nem interface: são as duas chamadas de rede que as duas
 * telas fazem, com os mesmos campos.
 */

import type { AnalyzedItem } from "@/lib/types";

export type IngestHeader = {
  supplier_name: string | null; store_name: string | null; supplier_vat: string | null;
  invoice_number: string | null; barcode: string | null; invoice_date: string | null;
  invoice_time: string | null; doc_type: string;
  total_net: number | null; total_vat: number | null; total_gross: number | null;
};

/** Qual regra de fornecedor pegou o documento (camada B1). */
export type SupplierRuleHit = {
  id: string; label: string; matched_by: "vat" | "name" | null;
  account_code: string | null; vat_category_code: string | null; line_items_off: boolean;
};

export type IngestDocument = {
  filename: string; engine: string; confidence: number; needs_review: boolean; issues: string[];
  audit?: { engine: string; confidence: number }[]; base_source: string;
  ai_matched?: number; cache_matched?: number; supplier_rule?: SupplierRuleHit | null;
  header: IngestHeader; items: AnalyzedItem[];
  /** 1-indexado, inclusivo; nulo quando o arquivo não foi dividido. */
  page_range: [number, number] | null;
  /** Os bytes da nota separada, quando um PDF trazia várias dentro. */
  pdf_base64: string | null;
};

export interface ReadContext {
  clientId: string;
  activityCode: string;
  defaultCreditUnmatched: boolean;
  relatedCategories: string[];
}

/**
 * Lê um arquivo. Devolve UM documento no caso normal e vários quando o PDF
 * trazia um lote de notas escaneadas em sequência.
 */
export async function readDocumentFile(file: File, ctx: ReadContext): Promise<IngestDocument[]> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("activity_code", ctx.activityCode);
  // Sem cliente escolhido não há regra de fornecedor: as regras são por cliente,
  // porque a mesma Vodafone vai para contas diferentes em empresas diferentes.
  fd.append("client_id", ctx.clientId || "");
  fd.append("default_credit_unmatched", String(ctx.defaultCreditUnmatched));
  fd.append("related_categories", JSON.stringify(ctx.relatedCategories ?? []));

  const res = await fetch("/api/extract", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Reading failed");
  const docs: IngestDocument[] = data.documents || [];
  if (!docs.length) throw new Error("Reading failed");
  return docs;
}

/** Um PDF dividido volta em base64; vira arquivo para poder ser gravado sozinho. */
export function base64ToFile(b64: string, filename: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: "application/pdf" });
}

export interface SaveContext {
  clientId: string;
  branchId: string;
  activityCode: string;
  postingDate: string;
  force?: boolean;
}

export type DuplicateMatch = {
  id: string; invoice_number: string | null; posting_date: string | null; total_gross: number | null;
};

export type SaveResult =
  | { kind: "saved"; id: string }
  | { kind: "duplicate"; existing: DuplicateMatch | null };

/**
 * Junta o documento desta duplicata ao lançamento que já existe (camada B3).
 *
 * É o oposto do que o sistema fazia: a segunda cópia era descartada, e com ela a
 * foto que muitas vezes está mais legível que a primeira. Nada do lançamento
 * muda — nem valor, nem crédito.
 */
export async function mergeIntoExisting(
  file: File, invoiceId: string, note?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fd = new FormData();
  fd.append("file", file);
  if (note) fd.append("note", note);
  const res = await fetch(`/api/invoices/${invoiceId}/documents`, { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || "Não foi possível juntar o documento." };
  return { ok: true };
}

export async function saveDocument(
  file: File, doc: IngestDocument, ctx: SaveContext
): Promise<SaveResult> {
  const h = doc.header;
  const meta = {
    client_id: ctx.clientId || null,
    branch_id: ctx.branchId || null,
    activity_code: ctx.activityCode,
    engine: doc.engine,
    original_filename: doc.filename,
    confidence: doc.confidence,
    needs_review: doc.needs_review,
    issues: doc.issues,
    audit: doc.audit,
    header: {
      supplier_name: h.supplier_name, store_name: h.store_name ?? null, supplier_vat: h.supplier_vat,
      invoice_number: h.invoice_number, barcode: h.barcode ?? null, invoice_date: h.invoice_date,
      posting_date: ctx.postingDate || null,
      invoice_time: h.invoice_time ?? null, doc_type: h.doc_type,
      total_net: h.total_net, total_vat: h.total_vat, total_gross: h.total_gross,
    },
    items: doc.items.map((it) => ({
      description: it.description, quantity: it.quantity, unit_price: it.unit_price,
      net_amount: it.net_amount, vat_rate_on_invoice: it.vat_rate_on_invoice,
      vat_amount_on_invoice: it.vat_amount_on_invoice, expected_vat_rate: it.expected_vat_rate,
      category_code: it.matched_category?.code ?? null,
      category_name: it.matched_category?.description ?? null,
      take_credit: !!it.take_credit,
      // A conta vem decidida pela regra de fornecedor; sem ela, a gravação
      // pergunta à memória item→conta (camada B1).
      account_code: it.account_code ?? null, account_name: it.account_name ?? null,
    })),
  };

  const fd = new FormData();
  fd.append("file", file);
  fd.append("meta", JSON.stringify(meta));
  if (ctx.force) fd.append("force", "true");

  const res = await fetch("/api/invoices", { method: "POST", body: fd });
  const data = await res.json();
  if (res.status === 409 && data.error === "duplicate") {
    return { kind: "duplicate", existing: data.existing ?? null };
  }
  if (!res.ok) throw new Error(data.error || "Save failed");
  return { kind: "saved", id: data.invoice.id };
}
