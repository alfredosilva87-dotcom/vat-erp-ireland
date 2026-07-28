// =====================================================================
// Bright / BrightBooks (Surf Accounts) — camada de EXPORT (ponte por arquivo)
// ---------------------------------------------------------------------
// Gera CSVs importáveis pela página "Data Import" do BrightBooks/Surf.
// NÃO precisa de API: o usuário baixa o CSV e importa dentro do Surf.
//
// ⚠️ LAYOUT PROVISÓRIO. Os cabeçalhos exatos das colunas são "gated" —
//    só saem do template baixado dentro de uma conta Surf/BrightBooks
//    (Data Import → download template). Quando você tiver o template
//    oficial, ajuste APENAS os arrays de colunas abaixo (COLS.*) e o
//    mapa VAT_CODE_BY_RATE. O resto do arquivo não precisa mudar.
// =====================================================================

import type { Client, StoredInvoice, StoredItem, SalesEntry } from "@/lib/types";

// ---------------------------------------------------------------------
// 1. CONFIG PROVISÓRIA — AJUSTE AQUI quando tiver o template oficial
// ---------------------------------------------------------------------

// Cabeçalhos (ordem = ordem das colunas no CSV gerado).
export const COLS = {
  // Contacts template (clientes/fornecedores)
  contacts: [
    "Type", // "Supplier" | "Customer"
    "Name",
    "Code",
    "VAT Number",
    "Email",
    "Phone",
    "Address",
    "Country",
  ],
  // Supplier Invoices (Detailed) — uma linha por item da nota
  purchases: [
    "Supplier Name",
    "Supplier VAT",
    "Invoice Date",
    "Invoice Number",
    "Reference",
    "Nominal Code",
    "Description",
    "Net Amount",
    "VAT Code",
    "VAT Rate",
    "VAT Amount",
    "Gross Amount",
    "Department",
    "Currency",
  ],
  // Journal (JournalFormat.csv) — partidas dobradas por nota
  journal: [
    "Date",
    "Reference",
    "Nominal Code",
    "Description",
    "Debit",
    "Credit",
    "VAT Code",
  ],
} as const;

// Alíquota (%) -> VAT code do Surf/BrightBooks. Códigos PROVISÓRIOS.
export const VAT_CODE_BY_RATE: Record<string, string> = {
  "23": "S", // standard
  "13.5": "R", // reduced
  "9": "R2", // second reduced
  "4.8": "L", // livestock
  "0": "Z", // zero
};

// Nominal code usado quando o item ainda não tem conta no plano de contas.
export const DEFAULT_NOMINAL_CODE = "";

// Nominais de contrapartida do journal (AJUSTE conforme seu plano no Surf).
export const CONTROL_ACCOUNTS = {
  accountsPayable: "2000", // Cr — Accounts Payable / Creditors
  vatOnPurchases: "2100", // Dr — VAT on Purchases (recoverable)
};

// ---------------------------------------------------------------------
// 2. HELPERS
// ---------------------------------------------------------------------

type Cell = string | number | null | undefined;

/** Serializa uma matriz em CSV RFC-4180 (aspas quando necessário). */
export function toCsv(rows: Cell[][]): string {
  const esc = (v: Cell) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM para o Excel/Surf reconhecerem UTF-8 corretamente.
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : Number(n).toFixed(2);

const rateKey = (r: number | null | undefined) =>
  r === null || r === undefined ? "" : String(Number(r));

const vatCode = (r: number | null | undefined) =>
  VAT_CODE_BY_RATE[rateKey(r)] ?? "";

/** Alíquota efetiva da linha: usa a esperada (base) e cai para a da nota. */
const lineRate = (it: StoredItem) =>
  it.expected_vat_rate ?? it.vat_rate_on_invoice ?? null;

// ---------------------------------------------------------------------
// 3. CONTACTS  (fornecedores das notas + clientes das vendas)
// ---------------------------------------------------------------------

export function buildContactsCsv(
  invoices: StoredInvoice[],
  sales: SalesEntry[],
  country = "IE"
): string {
  const rows: Cell[][] = [[...COLS.contacts]];

  // Fornecedores: únicos por (nome + VAT).
  const seen = new Set<string>();
  for (const inv of invoices) {
    const name = (inv.supplier_name || "").trim();
    if (!name) continue;
    const key = (name + "|" + (inv.supplier_vat || "")).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(["Supplier", name, "", inv.supplier_vat || "", "", "", "", country]);
  }

  // Clientes: únicos por nome (a partir das vendas lançadas).
  const seenC = new Set<string>();
  for (const s of sales) {
    const name = (s.customer || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seenC.has(key)) continue;
    seenC.add(key);
    rows.push(["Customer", name, "", "", "", "", "", country]);
  }

  return toCsv(rows);
}

// ---------------------------------------------------------------------
// 4. SUPPLIER INVOICES (Detailed) — uma linha por item
// ---------------------------------------------------------------------

export function buildPurchaseInvoicesCsv(
  invoices: StoredInvoice[],
  items: StoredItem[],
  currency = "EUR"
): string {
  const byInv = new Map<string, StoredInvoice>();
  for (const inv of invoices) byInv.set(inv.id, inv);

  const rows: Cell[][] = [[...COLS.purchases]];
  for (const it of items) {
    const inv = byInv.get(it.invoice_id);
    if (!inv) continue;
    const rate = lineRate(it);
    rows.push([
      inv.supplier_name || "",
      inv.supplier_vat || "",
      inv.invoice_date || inv.posting_date || "",
      inv.invoice_number || "",
      inv.original_filename || "",
      it.account_code || DEFAULT_NOMINAL_CODE,
      it.description || "",
      money(it.net_amount),
      vatCode(rate),
      rateKey(rate),
      money(it.vat_amount_on_invoice),
      money((it.net_amount ?? 0) + (it.vat_amount_on_invoice ?? 0)),
      inv.branch_name || "",
      currency,
    ]);
  }
  return toCsv(rows);
}

// ---------------------------------------------------------------------
// 5. JOURNAL — partidas dobradas por nota (Dr despesa + Dr VAT / Cr AP)
// ---------------------------------------------------------------------

export function buildJournalCsv(
  invoices: StoredInvoice[],
  items: StoredItem[]
): string {
  const itemsByInv = new Map<string, StoredItem[]>();
  for (const it of items) {
    const a = itemsByInv.get(it.invoice_id) || [];
    a.push(it);
    itemsByInv.set(it.invoice_id, a);
  }

  const rows: Cell[][] = [[...COLS.journal]];
  for (const inv of invoices) {
    const its = itemsByInv.get(inv.id) || [];
    if (!its.length) continue;
    const date = inv.posting_date || inv.invoice_date || "";
    const ref = inv.invoice_number || inv.original_filename || inv.id.slice(0, 8);

    // Dr — cada item na sua conta (net).
    for (const it of its) {
      rows.push([
        date,
        ref,
        it.account_code || DEFAULT_NOMINAL_CODE,
        it.description || inv.supplier_name || "",
        money(it.net_amount),
        "",
        vatCode(lineRate(it)),
      ]);
    }
    // Dr — VAT recuperável (total da nota).
    if (inv.total_vat) {
      rows.push([date, ref, CONTROL_ACCOUNTS.vatOnPurchases, "VAT on purchases", money(inv.total_vat), "", ""]);
    }
    // Cr — Accounts Payable (gross).
    rows.push([date, ref, CONTROL_ACCOUNTS.accountsPayable, inv.supplier_name || "Supplier", "", money(inv.total_gross), ""]);
  }
  return toCsv(rows);
}

export type BrightExportType = "contacts" | "purchases" | "journal";

export function filenameFor(type: BrightExportType, client: Client | null, year: number) {
  const code = client?.client_code || "client";
  return `bright_${type}_${code}_${year}.csv`;
}
