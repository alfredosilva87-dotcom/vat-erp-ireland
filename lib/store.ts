import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type {
  StoredInvoice,
  StoredItem,
  MasterItem,
  Client,
  ClientWithStats,
  CreditRule,
  ClientObligation,
  SalesEntry,
} from "@/lib/types";
import { FALLBACK_CREDIT_RULES } from "@/lib/fallbackBase";

// Local file-backed store. Documents under data/documents, records in
// data/db.json. Fully local (no Supabase yet). Swappable for DB + Storage later.

const DATA_DIR = path.join(process.cwd(), "data");
const DOCS_DIR = path.join(DATA_DIR, "documents");
const DB_FILE = path.join(DATA_DIR, "db.json");

type DB = {
  clients: Client[];
  invoices: StoredInvoice[];
  invoice_items: StoredItem[];
  items_master: MasterItem[];
  credit_rules: CreditRule[];
  obligations: ClientObligation[];
  sales: SalesEntry[];
};

function ensureDirs() {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
}

function readDB(): DB {
  ensureDirs();
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    return {
      clients: db.clients ?? [],
      invoices: db.invoices ?? [],
      invoice_items: db.invoice_items ?? [],
      items_master: db.items_master ?? [],
      credit_rules: db.credit_rules ?? [],
      obligations: db.obligations ?? [],
      sales: db.sales ?? [],
    };
  } catch {
    return { clients: [], invoices: [], invoice_items: [], items_master: [], credit_rules: [], obligations: [], sales: [] };
  }
}

function writeDB(db: DB) {
  ensureDirs();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
}

const normKey = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// ---------------- Clients ----------------
function nextClientCode(db: DB): string {
  const nums = db.clients
    .map((c) => parseInt((c.client_code || "").replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return "C" + String(next).padStart(4, "0");
}

export function listClients(q?: string): Client[] {
  const db = readDB();
  const sorted = [...db.clients].sort((a, b) => a.name.localeCompare(b.name));
  if (!q) return sorted;
  const s = normKey(q);
  return sorted.filter((c) =>
    normKey([c.name, c.client_code, c.vat_number, c.tax_reg_no, c.email].filter(Boolean).join(" ")).includes(s)
  );
}

export function getClient(id: string): Client | null {
  return readDB().clients.find((c) => c.id === id) ?? null;
}

export function createClient(input: Partial<Client>): Client {
  const db = readDB();
  const now = new Date().toISOString();
  const client: Client = {
    id: randomUUID(),
    client_code: input.client_code?.trim() || nextClientCode(db),
    name: (input.name || "").trim() || "Unnamed client",
    vat_number: input.vat_number?.trim() || null,
    tax_reg_no: input.tax_reg_no?.trim() || null,
    activity_code: input.activity_code || "GENERIC",
    activity_label: input.activity_label || "Generic business",
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    address: input.address?.trim() || null,
    notes: input.notes?.trim() || null,
    created_at: now,
  };
  db.clients.push(client);
  writeDB(db);
  return client;
}

export function updateClient(id: string, patch: Partial<Client>): Client | null {
  const db = readDB();
  const c = db.clients.find((x) => x.id === id);
  if (!c) return null;
  Object.assign(c, {
    name: patch.name ?? c.name,
    vat_number: patch.vat_number ?? c.vat_number,
    tax_reg_no: patch.tax_reg_no ?? c.tax_reg_no,
    activity_code: patch.activity_code ?? c.activity_code,
    activity_label: patch.activity_label ?? c.activity_label,
    email: patch.email ?? c.email,
    phone: patch.phone ?? c.phone,
    address: patch.address ?? c.address,
    notes: patch.notes ?? c.notes,
  });
  writeDB(db);
  return c;
}

export function deleteClient(id: string): boolean {
  const db = readDB();
  const before = db.clients.length;
  db.clients = db.clients.filter((c) => c.id !== id);
  writeDB(db);
  return db.clients.length < before;
}

export function clientsWithStats(q?: string): ClientWithStats[] {
  const db = readDB();
  const list = listClients(q);
  return list.map((c) => {
    const invs = db.invoices.filter((i) => i.client_id === c.id);
    return {
      ...c,
      invoice_count: invs.length,
      total_gross: Number(invs.reduce((a, i) => a + (i.total_gross || 0), 0).toFixed(2)),
      total_credit: Number(invs.reduce((a, i) => a + (i.total_credit || 0), 0).toFixed(2)),
    };
  });
}

// ---------------- de-para master ----------------
function findOrCreateMaster(
  db: DB, description: string, categoryCode: string | null,
  categoryName: string | null, expectedRate: number | null, now: string
): MasterItem {
  const key = normKey(description);
  let m = db.items_master.find((x) => x.norm_key === key);
  if (m) {
    m.occurrences += 1;
    m.last_seen = now;
    if (!m.category_code && categoryCode) {
      m.category_code = categoryCode; m.category_name = categoryName; m.expected_vat_rate = expectedRate;
    }
    return m;
  }
  m = {
    id: randomUUID(), norm_key: key, canonical_name: description.trim(),
    category_code: categoryCode, category_name: categoryName, expected_vat_rate: expectedRate,
    occurrences: 1, first_seen: now, last_seen: now,
  };
  db.items_master.push(m);
  return m;
}

export function lookupMasterCategories(descriptions: string[]): (string | null)[] {
  const db = readDB();
  const map = new Map<string, string>();
  for (const m of db.items_master) if (m.category_code) map.set(m.norm_key, m.category_code);
  return descriptions.map((d) => map.get(normKey(d)) ?? null);
}

export function listMasterItems(q?: string): MasterItem[] {
  const db = readDB();
  const sorted = [...db.items_master].sort((a, b) => b.occurrences - a.occurrences);
  if (!q) return sorted;
  const s = normKey(q);
  return sorted.filter(
    (m) => m.norm_key.includes(s) || (m.category_name || "").toLowerCase().includes(q.toLowerCase())
  );
}

// ---------------- Invoices ----------------
function creditValue(it: SaveItem): number {
  if (!it.take_credit) return 0;
  if (it.vat_amount_on_invoice != null) return it.vat_amount_on_invoice;
  if (it.net_amount != null && it.expected_vat_rate != null) return (it.net_amount * it.expected_vat_rate) / 100;
  return 0;
}

export interface SaveItem {
  description: string;
  quantity: number | null;
  net_amount: number | null;
  vat_rate_on_invoice: number | null;
  vat_amount_on_invoice: number | null;
  expected_vat_rate: number | null;
  category_code: string | null;
  category_name: string | null;
  take_credit: boolean;
}

export interface SavePayload {
  client_id: string | null;
  activity_code: string;
  engine: string;
  original_filename: string | null;
  header: {
    supplier_name: string | null;
    store_name: string | null;
    supplier_vat: string | null;
    invoice_number: string | null;
    barcode: string | null;
    invoice_date: string | null;
    invoice_time: string | null;
    doc_type: string;
    total_net: number | null;
    total_vat: number | null;
    total_gross: number | null;
  };
  items: SaveItem[];
}

export function saveInvoice(payload: SavePayload, fileBuffer: Buffer | null, ext: string): StoredInvoice {
  const db = readDB();
  const now = new Date().toISOString();
  const id = randomUUID();
  const client = payload.client_id ? db.clients.find((c) => c.id === payload.client_id) : null;

  let documentFile: string | null = null;
  if (fileBuffer) {
    const safeExt = (ext || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
    const fname = `${id}.${safeExt}`;
    fs.writeFileSync(path.join(DOCS_DIR, fname), fileBuffer);
    documentFile = `documents/${fname}`;
  }

  let totalCredit = 0;
  for (const it of payload.items) {
    const master = findOrCreateMaster(db, it.description, it.category_code, it.category_name, it.expected_vat_rate, now);
    const cv = creditValue(it);
    totalCredit += cv;
    db.invoice_items.push({
      id: randomUUID(), invoice_id: id, master_item_id: master.id,
      description: it.description, quantity: it.quantity, net_amount: it.net_amount,
      vat_rate_on_invoice: it.vat_rate_on_invoice, vat_amount_on_invoice: it.vat_amount_on_invoice,
      expected_vat_rate: it.expected_vat_rate, category_code: it.category_code, category_name: it.category_name,
      take_credit: it.take_credit, credit_value: Number(cv.toFixed(2)),
    });
  }

  const invoice: StoredInvoice = {
    id, created_at: now,
    client_id: client?.id ?? null,
    client_code: client?.client_code ?? null,
    client_name: client?.name ?? null,
    activity_code: payload.activity_code,
    supplier_name: payload.header.supplier_name, store_name: payload.header.store_name ?? null,
    supplier_vat: payload.header.supplier_vat,
    invoice_number: payload.header.invoice_number, barcode: payload.header.barcode ?? null,
    invoice_date: payload.header.invoice_date,
    invoice_time: payload.header.invoice_time, doc_type: payload.header.doc_type, currency: "EUR",
    total_net: payload.header.total_net, total_vat: payload.header.total_vat, total_gross: payload.header.total_gross,
    total_credit: Number(totalCredit.toFixed(2)), engine: payload.engine,
    original_filename: payload.original_filename, document_file: documentFile, item_count: payload.items.length,
  };
  db.invoices.unshift(invoice);
  writeDB(db);
  return invoice;
}

export function listInvoices(q?: string, clientId?: string): StoredInvoice[] {
  const db = readDB();
  let invoices = db.invoices;
  if (clientId) invoices = invoices.filter((i) => i.client_id === clientId);
  if (!q) return invoices;
  const s = normKey(q);
  const byInv = new Map<string, StoredItem[]>();
  for (const it of db.invoice_items) {
    const arr = byInv.get(it.invoice_id) || []; arr.push(it); byInv.set(it.invoice_id, arr);
  }
  return invoices.filter((inv) => {
    const hay = [
      inv.supplier_name, inv.invoice_number, inv.supplier_vat, inv.invoice_date, inv.client_name,
      ...(byInv.get(inv.id) || []).flatMap((it) => [it.description, it.category_name]),
    ].filter(Boolean).join(" ");
    return normKey(hay).includes(s);
  });
}

export function getInvoice(id: string) {
  const db = readDB();
  const invoice = db.invoices.find((i) => i.id === id);
  if (!invoice) return null;
  return { invoice, items: db.invoice_items.filter((i) => i.invoice_id === id) };
}

export function getDocumentAbsolutePath(id: string): string | null {
  const db = readDB();
  const invoice = db.invoices.find((i) => i.id === id);
  if (!invoice?.document_file) return null;
  return path.join(DATA_DIR, invoice.document_file);
}

export function stats(clientId?: string) {
  const db = readDB();
  const invoices = clientId ? db.invoices.filter((i) => i.client_id === clientId) : db.invoices;
  const ids = new Set(invoices.map((i) => i.id));
  const items = db.invoice_items.filter((i) => ids.has(i.invoice_id));
  return {
    invoices: invoices.length,
    items: items.length,
    unique_items: db.items_master.length,
    clients: db.clients.length,
    total_credit: Number(invoices.reduce((a, i) => a + (i.total_credit || 0), 0).toFixed(2)),
    total_gross: Number(invoices.reduce((a, i) => a + (i.total_gross || 0), 0).toFixed(2)),
  };
}

function recomputeCredit(it: StoredItem): number {
  if (!it.take_credit) return 0;
  if (it.vat_amount_on_invoice != null) return it.vat_amount_on_invoice;
  if (it.net_amount != null && it.expected_vat_rate != null)
    return (it.net_amount * it.expected_vat_rate) / 100;
  return 0;
}

// Update the take_credit flags of a saved invoice and recompute totals.
export function updateInvoiceCredits(
  invoiceId: string,
  credits: Record<string, boolean>
): { invoice: StoredInvoice; items: StoredItem[] } | null {
  const db = readDB();
  const invoice = db.invoices.find((i) => i.id === invoiceId);
  if (!invoice) return null;
  const items = db.invoice_items.filter((i) => i.invoice_id === invoiceId);
  let total = 0;
  for (const it of items) {
    if (Object.prototype.hasOwnProperty.call(credits, it.id)) it.take_credit = credits[it.id];
    const cv = recomputeCredit(it);
    it.credit_value = Number(cv.toFixed(2));
    total += cv;
  }
  invoice.total_credit = Number(total.toFixed(2));
  writeDB(db);
  return { invoice, items };
}

// Delete a saved invoice, its items and its document file.
export function deleteInvoice(invoiceId: string): boolean {
  const db = readDB();
  const inv = db.invoices.find((i) => i.id === invoiceId);
  if (!inv) return false;
  if (inv.document_file) {
    try {
      fs.unlinkSync(path.join(DATA_DIR, inv.document_file));
    } catch {
      /* ignore missing file */
    }
  }
  db.invoices = db.invoices.filter((i) => i.id !== invoiceId);
  db.invoice_items = db.invoice_items.filter((i) => i.invoice_id !== invoiceId);
  writeDB(db);
  return true;
}

// General edit of a saved invoice: header fields and/or item fields. Recomputes
// each item's credit value and the invoice total_credit.
export function updateInvoice(
  invoiceId: string,
  patch: {
    header?: Partial<StoredInvoice>;
    items?: Array<Partial<StoredItem> & { id: string }>;
  }
): { invoice: StoredInvoice; items: StoredItem[] } | null {
  const db = readDB();
  const invoice = db.invoices.find((i) => i.id === invoiceId);
  if (!invoice) return null;

  if (patch.header) {
    const h = patch.header;
    const editable: (keyof StoredInvoice)[] = [
      "supplier_name", "store_name", "supplier_vat", "invoice_number", "barcode",
      "invoice_date", "invoice_time", "doc_type", "total_net", "total_vat", "total_gross",
    ];
    for (const k of editable) {
      if (Object.prototype.hasOwnProperty.call(h, k)) (invoice as any)[k] = (h as any)[k];
    }
  }

  const items = db.invoice_items.filter((i) => i.invoice_id === invoiceId);
  if (patch.items) {
    const byId = new Map(items.map((it) => [it.id, it]));
    for (const upd of patch.items) {
      const it = byId.get(upd.id);
      if (!it) continue;
      const fields: (keyof StoredItem)[] = [
        "description", "quantity", "net_amount", "vat_rate_on_invoice",
        "expected_vat_rate", "category_code", "category_name", "take_credit",
      ];
      for (const k of fields) {
        if (Object.prototype.hasOwnProperty.call(upd, k)) (it as any)[k] = (upd as any)[k];
      }
      // Teach the de-para master when the category/rate was corrected.
      const taught =
        "category_code" in upd || "category_name" in upd || "expected_vat_rate" in upd;
      if (taught) {
        const m = db.items_master.find((mm) => mm.id === it.master_item_id);
        if (m) {
          m.category_code = it.category_code;
          m.category_name = it.category_name;
          m.expected_vat_rate = it.expected_vat_rate;
          m.last_seen = new Date().toISOString();
        }
      }
    }
  }

  let total = 0;
  for (const it of items) {
    const cv = recomputeCredit(it);
    it.credit_value = Number(cv.toFixed(2));
    total += cv;
  }
  invoice.total_credit = Number(total.toFixed(2));
  writeDB(db);
  return { invoice, items };
}

// ---------------- Credit rules (editable, per company type) ----------------
function ensureRulesSeeded(db: DB): boolean {
  if (db.credit_rules.length) return false;
  db.credit_rules = FALLBACK_CREDIT_RULES.map((r) => ({ ...r }));
  return true;
}

export function listCreditRules(): CreditRule[] {
  const db = readDB();
  if (ensureRulesSeeded(db)) writeDB(db);
  return [...db.credit_rules].sort((a, b) => a.priority - b.priority);
}

export function createCreditRule(input: Partial<CreditRule>): CreditRule {
  const db = readDB();
  ensureRulesSeeded(db);
  const rule: CreditRule = {
    id: randomUUID(),
    activity_code: input.activity_code || "*",
    vat_category_id: input.vat_category_id ?? null,
    match_keywords: Array.isArray(input.match_keywords) ? input.match_keywords : [],
    deductible_default: input.deductible_default !== false,
    rationale: input.rationale ?? null,
    priority: typeof input.priority === "number" ? input.priority : 100,
    active: input.active !== false,
  };
  db.credit_rules.push(rule);
  writeDB(db);
  return rule;
}

export function updateCreditRule(id: string, patch: Partial<CreditRule>): CreditRule | null {
  const db = readDB();
  ensureRulesSeeded(db);
  const r = db.credit_rules.find((x) => x.id === id);
  if (!r) return null;
  Object.assign(r, {
    activity_code: patch.activity_code ?? r.activity_code,
    match_keywords: patch.match_keywords ?? r.match_keywords,
    deductible_default:
      typeof patch.deductible_default === "boolean" ? patch.deductible_default : r.deductible_default,
    rationale: patch.rationale ?? r.rationale,
    priority: typeof patch.priority === "number" ? patch.priority : r.priority,
    active: typeof patch.active === "boolean" ? patch.active : r.active,
  });
  writeDB(db);
  return r;
}

export function deleteCreditRule(id: string): boolean {
  const db = readDB();
  const before = db.credit_rules.length;
  db.credit_rules = db.credit_rules.filter((r) => r.id !== id);
  writeDB(db);
  return db.credit_rules.length < before;
}

// ---------------- Master item edit ----------------
export function updateMasterItem(id: string, patch: Partial<MasterItem>): MasterItem | null {
  const db = readDB();
  const m = db.items_master.find((x) => x.id === id);
  if (!m) return null;
  Object.assign(m, {
    canonical_name: patch.canonical_name ?? m.canonical_name,
    category_code: patch.category_code !== undefined ? patch.category_code : m.category_code,
    category_name: patch.category_name !== undefined ? patch.category_name : m.category_name,
    expected_vat_rate:
      patch.expected_vat_rate !== undefined ? patch.expected_vat_rate : m.expected_vat_rate,
    last_seen: new Date().toISOString(),
  });
  writeDB(db);
  return m;
}

export function deleteMasterItem(id: string): boolean {
  const db = readDB();
  const before = db.items_master.length;
  db.items_master = db.items_master.filter((m) => m.id !== id);
  writeDB(db);
  return db.items_master.length < before;
}

// ---------------- Tax obligations (VAT3 bi-monthly + annual RTD) ----------------
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Input VAT reclaimable for a client in a date window = sum of taken credit.
function inputVatInPeriod(db: DB, clientId: string, start: string, end: string): number {
  const total = db.invoices
    .filter((i) => i.client_id === clientId && i.invoice_date && i.invoice_date >= start && i.invoice_date <= end)
    .reduce((a, i) => a + (i.total_credit || 0), 0);
  return Number(total.toFixed(2));
}

function salesVatInPeriod(db: DB, clientId: string, start: string, end: string): number {
  const total = db.sales
    .filter((x) => x.client_id === clientId && x.entry_date >= start && x.entry_date <= end)
    .reduce((a, x) => a + (x.vat_amount || 0), 0);
  return Number(total.toFixed(2));
}

function generateForYear(db: DB, clientId: string, year: number): ClientObligation[] {
  const out: ClientObligation[] = [];
  // 6 bi-monthly VAT3 periods
  for (let m = 0; m < 12; m += 2) {
    const start = new Date(Date.UTC(year, m, 1));
    const end = new Date(Date.UTC(year, m + 2, 0)); // last day of second month
    const due = new Date(Date.UTC(year, m + 2, 23)); // 23rd of following month
    const purchases = inputVatInPeriod(db, clientId, iso(start), iso(end));
    const sales = salesVatInPeriod(db, clientId, iso(start), iso(end));
    out.push({
      id: randomUUID(),
      client_id: clientId,
      kind: "VAT3",
      period_label: `${MONTHS[m]}–${MONTHS[m + 1]} ${year}`,
      period_start: iso(start),
      period_end: iso(end),
      due_date: iso(due),
      year,
      status: "open",
      vat_on_sales: sales || null,
      vat_on_purchases: purchases,
      net: sales || purchases ? Number((sales - purchases).toFixed(2)) : null,
      notes: null,
      filed_at: null,
    });
  }
  // Annual RTD (Return of Trading Details)
  const rStart = new Date(Date.UTC(year, 0, 1));
  const rEnd = new Date(Date.UTC(year, 11, 31));
  out.push({
    id: randomUUID(),
    client_id: clientId,
    kind: "RTD",
    period_label: `RTD ${year}`,
    period_start: iso(rStart),
    period_end: iso(rEnd),
    due_date: iso(new Date(Date.UTC(year + 1, 0, 23))),
    year,
    status: "open",
    vat_on_sales: salesVatInPeriod(db, clientId, iso(rStart), iso(rEnd)) || null,
    vat_on_purchases: inputVatInPeriod(db, clientId, iso(rStart), iso(rEnd)),
    net: null,
    notes: null,
    filed_at: null,
  });
  return out;
}

export function getObligations(clientId: string, year: number): ClientObligation[] {
  const db = readDB();
  let list = db.obligations.filter((o) => o.client_id === clientId && o.year === year);
  if (!list.length) {
    list = generateForYear(db, clientId, year);
    db.obligations.push(...list);
    writeDB(db);
  }
  return list.sort((a, b) => a.period_start.localeCompare(b.period_start));
}

// Recompute the auto-suggested purchases VAT from current invoices (non-filed only).
export function refreshObligations(clientId: string, year: number): ClientObligation[] {
  const db = readDB();
  const list = db.obligations.filter((o) => o.client_id === clientId && o.year === year);
  for (const o of list) {
    if (o.status === "filed") continue;
    o.vat_on_purchases = inputVatInPeriod(db, clientId, o.period_start, o.period_end);
    const sv = salesVatInPeriod(db, clientId, o.period_start, o.period_end);
    if (sv) o.vat_on_sales = sv;
    o.net = Number(((o.vat_on_sales || 0) - (o.vat_on_purchases || 0)).toFixed(2));
  }
  writeDB(db);
  return list.sort((a, b) => a.period_start.localeCompare(b.period_start));
}

export function updateObligation(id: string, patch: Partial<ClientObligation>): ClientObligation | null {
  const db = readDB();
  const o = db.obligations.find((x) => x.id === id);
  if (!o) return null;
  if (patch.vat_on_sales !== undefined) o.vat_on_sales = patch.vat_on_sales;
  if (patch.vat_on_purchases !== undefined) o.vat_on_purchases = patch.vat_on_purchases;
  if (patch.notes !== undefined) o.notes = patch.notes;
  if (patch.status !== undefined) {
    o.status = patch.status;
    o.filed_at = patch.status === "filed" ? new Date().toISOString() : null;
  }
  o.net =
    o.vat_on_sales != null || o.vat_on_purchases != null
      ? Number(((o.vat_on_sales || 0) - (o.vat_on_purchases || 0)).toFixed(2))
      : null;
  writeDB(db);
  return o;
}

// Monthly gross + credit series for charts (12 months of a year).
export function monthlySeries(clientId: string, year: number) {
  const db = readDB();
  const months = Array.from({ length: 12 }, (_, m) => ({ month: MONTHS[m], gross: 0, credit: 0, count: 0 }));
  for (const inv of db.invoices) {
    if (inv.client_id !== clientId || !inv.invoice_date) continue;
    if (!inv.invoice_date.startsWith(String(year))) continue;
    const m = Number(inv.invoice_date.slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    months[m].gross += inv.total_gross || 0;
    months[m].credit += inv.total_credit || 0;
    months[m].count += 1;
  }
  return months.map((x) => ({ ...x, gross: Number(x.gross.toFixed(2)), credit: Number(x.credit.toFixed(2)) }));
}

// ---------------- Sales (emitted invoices -> VAT on sales, T1) ----------------
export function listSales(clientId: string): SalesEntry[] {
  return readDB().sales
    .filter((s) => s.client_id === clientId)
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date));
}

export function addSalesEntries(
  clientId: string,
  rows: Array<Partial<SalesEntry>>
): SalesEntry[] {
  const db = readDB();
  const now = new Date().toISOString();
  const created: SalesEntry[] = [];
  for (const r of rows) {
    if (!r.entry_date) continue;
    const net = r.net_amount ?? null;
    const rate = r.vat_rate ?? null;
    const vat =
      r.vat_amount != null
        ? Number(r.vat_amount)
        : net != null && rate != null
        ? Number(((net * rate) / 100).toFixed(2))
        : 0;
    const e: SalesEntry = {
      id: randomUUID(),
      client_id: clientId,
      entry_date: r.entry_date,
      doc_number: r.doc_number ?? null,
      customer: r.customer ?? null,
      net_amount: net,
      vat_rate: rate,
      vat_amount: Number(vat.toFixed(2)),
      notes: r.notes ?? null,
      created_at: now,
    };
    db.sales.push(e);
    created.push(e);
  }
  writeDB(db);
  return created;
}

export function deleteSalesEntry(id: string): boolean {
  const db = readDB();
  const before = db.sales.length;
  db.sales = db.sales.filter((s) => s.id !== id);
  writeDB(db);
  return db.sales.length < before;
}
