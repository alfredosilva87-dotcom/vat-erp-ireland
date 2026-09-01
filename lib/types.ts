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

/**
 * O que o documento é, decidido na mesma leitura que extrai os valores.
 *
 * "illegible" e "not_a_document" são a SUJEIRA: o primeiro é documento fiscal
 * que não dá para ler, o segundo nem documento é. Separá-los importa porque a
 * saída é diferente — um pede foto nova, o outro é descarte direto.
 */
export type DocKind = "invoice" | "receipt" | "sales_sheet" | "illegible" | "not_a_document";

/** Sujeira: nada aqui deve virar lançamento. */
export const isJunkKind = (k: DocKind | null | undefined) =>
  k === "illegible" || k === "not_a_document";

export interface RawExtraction {
  doc_kind: DocKind;
  /** Por que foi classificado como ilegível / não-documento. */
  doc_kind_reason: string | null;
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
  /**
   * Por onde a nota entrou: "upload" (arquivo escolhido à mão), "email"
   * (caixa do escritório, camada B2) ou "phone" (foto pelo app de passagem,
   * camada B4). `null` = gravada antes de o sistema guardar isso.
   */
  source: string | null;
  extraction_confidence: number | null;
  needs_review: boolean;
  review_notes: string[];
  extraction_audit: { engine: string; confidence: number }[];
  /** Quem conferiu e quando (camada B3). Nulo = ninguém aprovou ainda. */
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewed_by_email: string | null;
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
  /**
   * A conta do razão desta conta bancária. Nula = 1100.
   *
   * É o que faz a baixa creditar o banco certo quando o cliente tem mais de
   * uma conta — ver a migração 029.
   */
  account_code: string | null;
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
  /**
   * De onde parte a conta: o último fechamento TRAVADO, ou nulo se ainda não
   * houve nenhum. É o "saldo anterior" de um extrato — e é o que impede o
   * sistema de somar o histórico inteiro a cada leitura (ver a migração 028).
   */
  anchor_date: string | null;
  anchor_balance: number;
  anchor_statement_balance: number;
  /** O que se moveu depois da âncora — o "do período". */
  movement_since_anchor: number;
  movement_count_since_anchor: number;
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
  /**
   * `sole_trader` ou `limited_company`. NULO é legítimo: cliente por
   * classificar. Decide as obrigações e os limiares — ver lib/fiscal/formaJuridica.ts.
   */
  legal_form?: "sole_trader" | "limited_company" | null;
  /** O nome comercial, quando difere do que está no registo. */
  trading_name?: string | null;
  director?: string | null;
  /** Número do CRO. Existe no banco desde a migração 018 e faltava no tipo. */
  cro?: string | null;
  /**
   * O fecho do exercício em `MM-DD`, e a Annual Return Date do CRO.
   *
   * São os dois dados de que a agenda fiscal precisa e não consegue deduzir: o
   * CT1 vence nove meses depois do fecho, e a B1 conta 56 dias a partir da
   * data da anual. Ver lib/fiscal/calendario.ts.
   */
  financial_year_end?: string | null;
  annual_return_date?: string | null;
  /** O que sai impresso nas faturas emitidas — ver components/ClientInvoiceBranding.tsx. */
  logo_path?: string | null;
  invoice_footer?: string | null;
  invoice_bank_account_id?: string | null;
}

export interface ClientWithStats extends Client {
  invoice_count: number;
  total_gross: number;
  total_credit: number;
}

export interface ClientObligation {
  id: string;
  client_id: string;
  /**
   * As seis que a agenda conhece. VAT3 e RTD vêm do IVA; as outras quatro vêm
   * da forma jurídica do cliente — ver lib/fiscal/calendario.ts.
   */
  kind: "VAT3" | "RTD" | "CT1" | "B1" | "FORM11" | "PRELIMINARY_TAX";
  period_label: string;
  period_start: string;
  period_end: string;
  /**
   * NULO quando o cadastro ainda não dá para saber o prazo — o CT1 sem fecho
   * do exercício, a B1 sem a data da anual. Inventar uma data punha na agenda
   * um prazo que ninguém confirmou, e a verde. Ver selfhost/schema/044.
   */
  due_date: string | null;
  year: number;
  status: "open" | "filed";
  vat_on_sales: number | null;      // T1
  vat_on_purchases: number | null;  // T2 (input VAT reclaimable)
  net: number | null;               // T3 payable (>0) / repayable (<0)
  notes: string | null;
  filed_at: string | null;
}

/** Obrigação recorrente manual (módulo Fiscal) — ver selfhost/schema/011_recurring_obligations.sql. */
export interface RecurringObligation {
  id: string;
  client_id: string;
  name: string;
  category: string | null;
  periodicity: string | null;
  due_date: string | null;
  status: string; // 'open' | 'done', texto livre de propósito
  notes: string | null;
  created_at: string;
  updated_at: string;
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
  /** O documento que sustenta a venda — ver 014_sales_document.sql. */
  document_path: string | null;
  original_filename: string | null;
  /** "upload" | "email" | "phone" | null (digitada/planilha). Ver lib/origin.ts. */
  source: string | null;
  needs_review: boolean;
  extraction_confidence: number | null;
  /** Quem conferiu e quando — ver 016_sales_reviewed.sql. */
  reviewed_at: string | null;
  reviewed_by_email: string | null;
  created_at: string;
}

/** Uma linha da venda. Documento sem itens legíveis grava uma linha genérica. */
export interface SalesItem {
  id: string;
  sale_id: string;
  description: string;
  quantity: number | null;
  unit_price: number | null;
  net_amount: number | null;
  vat_rate: number | null;
  vat_amount: number;
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
  /** null = acesso total. Lista de ids de tela — ver lib/permissions.ts. */
  screen_access: string[] | null;
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
