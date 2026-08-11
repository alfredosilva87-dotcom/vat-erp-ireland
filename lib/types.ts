// Shared domain types.

import type { ColumnMapping } from "@/lib/bankStatement";

export type VatRateType =
  | "standard"
  | "reduced"
  | "second_reduced"
  | "livestock"
  | "zero"
  | "exempt";

export type InconsistencyFlag =
  | "ok"
  | "rate_mismatch"
  | "no_vat_on_doc"
  | "unmatched";

// "supplier_rule" (camada B1) fica acima de keyword/learned/ai: é decisão
// escrita pelo contador, não dedução sobre o texto do item.
export type MatchSource = "keyword" | "learned" | "ai" | "none" | "supplier_rule";

export interface VatCategory {
  id: string;
  code: string | null;
  description: string;
  keywords: string[];
  vat_rate: number;
  rate_type: VatRateType;
  effective_from: string;
  effective_to: string | null;
  active: boolean;
}

export interface CreditRule {
  id: string;
  activity_code: string;
  vat_category_id: string | null;
  match_keywords: string[];
  deductible_default: boolean;
  rationale: string | null;
  priority: number;
  active: boolean;
}

export interface RawItem {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  net_amount: number | null;
  vat_rate_on_invoice: number | null;
  vat_amount_on_invoice: number | null;
}

export interface RawExtraction {
  supplier_name: string | null;
  store_name: string | null;
  supplier_vat: string | null;
  invoice_number: string | null;
  barcode: string | null;
  invoice_date: string | null;
  invoice_time: string | null; // HH:MM if present
  doc_type: "invoice" | "receipt" | "other";
  total_net: number | null;
  total_vat: number | null;
  total_gross: number | null;
  items: RawItem[];
}

export interface ExtractionAttempt {
  engine: "pdf-native" | "gemini-vision" | "tesseract";
  confidence: number;
}

export interface ExtractionResult {
  engine: "pdf-native" | "gemini-vision" | "tesseract";
  confidence: number;
  needs_review: boolean;
  issues: string[];
  audit: ExtractionAttempt[];
  data: RawExtraction;
}

export interface AnalyzedItem extends RawItem {
  matched_category: VatCategory | null;
  expected_vat_rate: number | null;
  match_confidence: number;
  match_source: MatchSource; // how the category was identified
  inconsistency: InconsistencyFlag;
  credit_suggested: boolean | null;
  credit_rationale: string | null;
  take_credit: boolean | null;
  /**
   * Conta contábil já decidida na leitura por uma regra de fornecedor (B1).
   * Ausente = ninguém decidiu ainda, e a memória de item→conta preenche na
   * gravação (lib/store.ts). Ver a precedência em lib/supplierRules.ts.
   */
  account_code?: string | null;
  account_name?: string | null;
}

// ---- Persistence (local store) ----
export interface StoredInvoice {
  id: string;
  created_at: string;
  client_id: string | null;
  client_code: string | null;
  client_name: string | null;
  activity_code: string;
  branch_id: string | null;
  branch_name: string | null;
  supplier_name: string | null;
  store_name: string | null;
  supplier_vat: string | null;
  invoice_number: string | null;
  barcode: string | null;
  invoice_date: string | null;
  posting_date: string | null;
  invoice_time: string | null;
  doc_type: string;
  currency: string;
  total_net: number | null;
  total_vat: number | null;
  total_gross: number | null;
  total_credit: number;
  engine: string;
  extraction_confidence: number | null;
  needs_review: boolean;
  review_notes: string[];
  extraction_audit: { engine: string; confidence: number }[];
  original_filename: string | null;
  document_file: string | null; // relative path under data/
  item_count: number;
}

export interface StoredItem {
  id: string;
  invoice_id: string;
  master_item_id: string;
  description: string;
  quantity: number | null;
  unit_price: number | null;
  net_amount: number | null;
  vat_rate_on_invoice: number | null;
  vat_amount_on_invoice: number | null;
  expected_vat_rate: number | null;
  category_code: string | null;
  category_name: string | null;
  account_code: string | null;
  account_name: string | null;
  take_credit: boolean;
  credit_value: number;
}

export interface Branch {
  id: string;
  client_id: string;
  code: string | null;
  name: string;
  address: string | null;
  notes: string | null;
  created_at: string;
}

// ---------------- Conciliação bancária (camadas A0/A1) ----------------
// O modelo de duas séries: `bank_statement_lines` é o que o BANCO diz,
// `bank_transactions` é o que foi lançado AQUI. Conciliar não altera nenhum
// dos dois — só cria o vínculo. Ver selfhost/schema/004_bank_reconciliation.sql.

export interface BankAccount {
  id: string;
  client_id: string;
  name: string;
  bank_name: string | null;
  account_ref: string | null;
  currency: string;
  opening_balance: number;
  opening_date: string | null;
  active: boolean;
  /** Formato do extrato deste banco, confirmado uma vez e reusado sempre. */
  column_mapping: ColumnMapping | null;
  created_at: string;
}

/** Os dois saldos da view `bank_account_balances`. A diferença entre eles é o que falta conciliar. */
export interface BankAccountBalance {
  bank_account_id: string;
  client_id: string;
  name: string;
  currency: string;
  opening_balance: number;
  statement_balance: number;
  system_balance: number;
  unreconciled_statement_total: number;
  unreconciled_statement_count: number;
  outstanding_transaction_total: number;
  outstanding_transaction_count: number;
}

export interface StoredStatementLine {
  id: string;
  bank_account_id: string;
  import_id: string | null;
  line_date: string;
  description: string | null;
  payee: string | null;
  reference: string | null;
  /** Positivo entra, negativo sai — sempre, qualquer que fosse a forma do arquivo. */
  amount: number;
  balance: number | null;
  source: string;
  dedupe_key: string;
  status: "unreconciled" | "reconciled" | "ignored";
  reconciled_at: string | null;
  created_at: string;
}

export interface BankImport {
  id: string;
  bank_account_id: string;
  filename: string | null;
  format: string | null;
  line_count: number;
  skipped_count: number;
  imported_by: string | null;
  created_at: string;
}

export interface ChartAccount {
  id: string;
  client_id: string | null;
  code: string;
  description: string;
  parent_code: string | null;
  active: boolean;
  created_at: string;
}

export interface MasterItem {
  id: string;
  norm_key: string;
  canonical_name: string;
  category_code: string | null;
  category_name: string | null;
  expected_vat_rate: number | null;
  occurrences: number;
  first_seen: string;
  last_seen: string;
}

export interface Client {
  id: string;
  client_code: string;
  name: string;
  vat_number: string | null;   // IE VAT number
  tax_reg_no: string | null;   // Revenue Tax Registration Number
  activity_code: string;
  activity_label: string;
  default_credit_unmatched: boolean;
  /** vat_categories.code values this client sells/uses — empty = check not configured. */
  related_categories: string[];
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
}

export interface ClientWithStats extends Client {
  invoice_count: number;
  total_gross: number;
  total_credit: number;
}

export interface ClientObligation {
  id: string;
  client_id: string;
  kind: "VAT3" | "RTD";
  period_label: string;
  period_start: string;
  period_end: string;
  due_date: string;
  year: number;
  status: "open" | "filed";
  vat_on_sales: number | null;      // T1
  vat_on_purchases: number | null;  // T2 (input VAT reclaimable)
  net: number | null;               // T3 payable (>0) / repayable (<0)
  notes: string | null;
  filed_at: string | null;
}

export interface SalesEntry {
  id: string;
  client_id: string;
  entry_date: string;      // yyyy-mm-dd
  doc_number: string | null;
  customer: string | null;
  net_amount: number | null;
  vat_rate: number | null;
  vat_amount: number;      // VAT on sales (T1 contribution)
  notes: string | null;
  created_at: string;
}

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  role: string;          // 'user' | 'admin' | 'master'
  active: boolean;
  must_change: boolean;
  company_id: string | null;
  created_at: string;
}

/** Tenant: the accounting practice using the system. */
export interface Company {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  license_key: string | null;
  license_expires_at: string | null;
  pending_license_key: string | null;
  pending_license_expires_at: string | null;
  contact_email: string | null;
  notes: string | null;
  created_at: string;
}

export interface LicenseEvent {
  id: string;
  company_id: string;
  event_type: string;
  old_expires_at: string | null;
  new_expires_at: string | null;
  actor_email: string | null;
  created_at: string;
}
