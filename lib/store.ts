import { randomUUID } from "crypto";
import { getServerSupabase } from "@/lib/supabase";
import type {
  StoredInvoice, StoredItem, MasterItem, Client, ClientWithStats,
  CreditRule, ClientObligation, SalesEntry, AppUser, ChartAccount,
} from "@/lib/types";

// Supabase-backed data layer (server-only, service-role). Same export names.

const sb = () => getServerSupabase();
const BUCKET = "documents";

const normKey = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

function toInvoice(r: any): StoredInvoice {
  return { ...r, document_file: r.document_path ?? null } as StoredInvoice;
}

// ---------------- Clients ----------------
export async function listClients(q?: string): Promise<Client[]> {
  const { data } = await sb().from("clients").select("*").order("name");
  const list = (data ?? []) as Client[];
  if (!q) return list;
  const s = normKey(q);
  return list.filter((c) =>
    normKey([c.name, c.client_code, c.vat_number, c.tax_reg_no, c.email].filter(Boolean).join(" ")).includes(s)
  );
}
export async function getClient(id: string): Promise<Client | null> {
  const { data } = await sb().from("clients").select("*").eq("id", id).maybeSingle();
  return (data as Client) ?? null;
}
async function nextClientCode(): Promise<string> {
  const { data } = await sb().from("clients").select("client_code");
  const nums = (data ?? [])
    .map((c: any) => parseInt(String(c.client_code || "").replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n));
  return "C" + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0");
}
export async function createClient(input: Partial<Client>): Promise<Client> {
  const row = {
    client_code: input.client_code?.trim() || (await nextClientCode()),
    name: (input.name || "").trim() || "Unnamed client",
    vat_number: input.vat_number?.trim() || null,
    tax_reg_no: input.tax_reg_no?.trim() || null,
    activity_code: input.activity_code || "GENERIC",
    activity_label: input.activity_label || "Generic business",
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    address: input.address?.trim() || null,
    notes: input.notes?.trim() || null,
  };
  const { data, error } = await sb().from("clients").insert(row).select().single();
  if (error) throw error;
  return data as Client;
}
export async function updateClient(id: string, patch: Partial<Client>): Promise<Client | null> {
  const row: any = {};
  for (const k of ["name","vat_number","tax_reg_no","activity_code","activity_label","email","phone","address","notes"])
    if (k in patch) row[k] = (patch as any)[k];
  const { data } = await sb().from("clients").update(row).eq("id", id).select().maybeSingle();
  return (data as Client) ?? null;
}
export async function deleteClient(id: string): Promise<boolean> {
  const { error } = await sb().from("clients").delete().eq("id", id);
  return !error;
}
export async function clientsWithStats(q?: string): Promise<ClientWithStats[]> {
  const clients = await listClients(q);
  const { data: invs } = await sb().from("invoices").select("client_id,total_gross,total_credit");
  return clients.map((c) => {
    const mine = (invs ?? []).filter((i: any) => i.client_id === c.id);
    return {
      ...c,
      invoice_count: mine.length,
      total_gross: Number(mine.reduce((a: number, i: any) => a + (i.total_gross || 0), 0).toFixed(2)),
      total_credit: Number(mine.reduce((a: number, i: any) => a + (i.total_credit || 0), 0).toFixed(2)),
    };
  });
}

// ---------------- Credit rules ----------------
export async function listCreditRules(): Promise<CreditRule[]> {
  const { data } = await sb().from("credit_rules").select("*").order("priority");
  return (data ?? []) as CreditRule[];
}
export async function createCreditRule(input: Partial<CreditRule>): Promise<CreditRule> {
  const row = {
    activity_code: input.activity_code || "*",
    vat_category_id: input.vat_category_id ?? null,
    match_keywords: Array.isArray(input.match_keywords) ? input.match_keywords : [],
    deductible_default: input.deductible_default !== false,
    rationale: input.rationale ?? null,
    priority: typeof input.priority === "number" ? input.priority : 100,
    active: input.active !== false,
  };
  const { data, error } = await sb().from("credit_rules").insert(row).select().single();
  if (error) throw error;
  return data as CreditRule;
}
export async function updateCreditRule(id: string, patch: Partial<CreditRule>): Promise<CreditRule | null> {
  const row: any = {};
  for (const k of ["activity_code","match_keywords","deductible_default","rationale","priority","active"])
    if (k in patch) row[k] = (patch as any)[k];
  const { data } = await sb().from("credit_rules").update(row).eq("id", id).select().maybeSingle();
  return (data as CreditRule) ?? null;
}
export async function deleteCreditRule(id: string): Promise<boolean> {
  const { error } = await sb().from("credit_rules").delete().eq("id", id);
  return !error;
}

// ---------------- Items master ----------------
export async function listMasterItems(q?: string): Promise<MasterItem[]> {
  const { data } = await sb().from("items_master").select("*").order("occurrences", { ascending: false });
  const list = (data ?? []) as MasterItem[];
  if (!q) return list;
  const s = normKey(q);
  return list.filter((m) => m.norm_key.includes(s) || (m.category_name || "").toLowerCase().includes(q.toLowerCase()));
}
export async function lookupMasterCategories(descriptions: string[]): Promise<(string | null)[]> {
  const keys = descriptions.map(normKey);
  const { data } = await sb().from("items_master").select("norm_key,category_code").in("norm_key", Array.from(new Set(keys)));
  const map = new Map<string, string>();
  for (const m of data ?? []) if (m.category_code) map.set(m.norm_key, m.category_code);
  return keys.map((k) => map.get(k) ?? null);
}
export async function updateMasterItem(id: string, patch: Partial<MasterItem>): Promise<MasterItem | null> {
  const row: any = { last_seen: new Date().toISOString() };
  for (const k of ["canonical_name","category_code","category_name","expected_vat_rate","account_code","account_name"])
    if (k in patch) row[k] = (patch as any)[k];
  const { data } = await sb().from("items_master").update(row).eq("id", id).select().maybeSingle();
  return (data as MasterItem) ?? null;
}
export async function deleteMasterItem(id: string): Promise<boolean> {
  const { error } = await sb().from("items_master").delete().eq("id", id);
  return !error;
}
async function findOrCreateMaster(description: string, code: string | null, name: string | null, rate: number | null): Promise<string> {
  const key = normKey(description);
  const now = new Date().toISOString();
  const { data: existing } = await sb().from("items_master").select("*").eq("norm_key", key).maybeSingle();
  if (existing) {
    const upd: any = { occurrences: (existing.occurrences || 0) + 1, last_seen: now };
    if (!existing.category_code && code) { upd.category_code = code; upd.category_name = name; upd.expected_vat_rate = rate; }
    await sb().from("items_master").update(upd).eq("id", existing.id);
    return existing.id;
  }
  const { data } = await sb().from("items_master").insert({
    norm_key: key, canonical_name: description.trim(), category_code: code, category_name: name,
    expected_vat_rate: rate, occurrences: 1, first_seen: now, last_seen: now,
  }).select("id").single();
  return data!.id as string;
}

// ---------------- Invoices ----------------
export interface SaveItem {
  description: string; quantity: number | null; net_amount: number | null;
  vat_rate_on_invoice: number | null; vat_amount_on_invoice: number | null; expected_vat_rate: number | null;
  category_code: string | null; category_name: string | null; take_credit: boolean;
}
export interface SavePayload {
  client_id: string | null; activity_code: string; engine: string; original_filename: string | null;
  header: {
    supplier_name: string | null; store_name: string | null; supplier_vat: string | null;
    invoice_number: string | null; barcode: string | null; invoice_date: string | null;
    posting_date: string | null; invoice_time: string | null; doc_type: string;
    total_net: number | null; total_vat: number | null; total_gross: number | null;
  };
  items: SaveItem[];
}
const itemCredit = (it: { take_credit: boolean; vat_amount_on_invoice: number | null; net_amount: number | null; expected_vat_rate: number | null }) => {
  if (!it.take_credit) return 0;
  if (it.vat_amount_on_invoice != null) return it.vat_amount_on_invoice;
  if (it.net_amount != null && it.expected_vat_rate != null) return (it.net_amount * it.expected_vat_rate) / 100;
  return 0;
};

export async function saveInvoice(payload: SavePayload, fileBuffer: Buffer | null, ext: string): Promise<StoredInvoice> {
  const id = randomUUID();
  const client = payload.client_id ? await getClient(payload.client_id) : null;

  let documentPath: string | null = null;
  if (fileBuffer) {
    const safeExt = (ext || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
    const path = `${id}.${safeExt}`;
    const ct = safeExt === "pdf" ? "application/pdf" : `image/${safeExt === "jpg" ? "jpeg" : safeExt}`;
    const { error } = await sb().storage.from(BUCKET).upload(path, fileBuffer, { contentType: ct, upsert: true });
    if (!error) documentPath = path;
  }

  // Pre-fill accounting account from the client's learned de-para (item -> account)
  const learned = client ? await learnedAccounts(client.id, payload.items.map((i) => i.description)) : {};

  let totalCredit = 0;
  const itemRows: any[] = [];
  for (const it of payload.items) {
    const masterId = await findOrCreateMaster(it.description, it.category_code, it.category_name, it.expected_vat_rate);
    const cv = itemCredit(it);
    totalCredit += cv;
    const acc = learned[normKey(it.description)] || { code: null, name: null };
    itemRows.push({
      invoice_id: id, master_item_id: masterId, description: it.description, quantity: it.quantity,
      net_amount: it.net_amount, vat_rate_on_invoice: it.vat_rate_on_invoice, vat_amount_on_invoice: it.vat_amount_on_invoice,
      expected_vat_rate: it.expected_vat_rate, category_code: it.category_code, category_name: it.category_name,
      account_code: acc.code, account_name: acc.name,
      take_credit: it.take_credit, credit_value: Number(cv.toFixed(2)),
    });
  }

  const invRow = {
    id, client_id: client?.id ?? null, client_code: client?.client_code ?? null, client_name: client?.name ?? null,
    activity_code: payload.activity_code, supplier_name: payload.header.supplier_name, store_name: payload.header.store_name,
    supplier_vat: payload.header.supplier_vat, invoice_number: payload.header.invoice_number, barcode: payload.header.barcode,
    invoice_date: payload.header.invoice_date, posting_date: payload.header.posting_date || new Date().toISOString().slice(0, 10),
    invoice_time: payload.header.invoice_time, doc_type: payload.header.doc_type,
    currency: "EUR", total_net: payload.header.total_net, total_vat: payload.header.total_vat, total_gross: payload.header.total_gross,
    total_credit: Number(totalCredit.toFixed(2)), engine: payload.engine, original_filename: payload.original_filename,
    document_path: documentPath, item_count: payload.items.length,
  };
  const { data, error } = await sb().from("invoices").insert(invRow).select().single();
  if (error) throw error;
  if (itemRows.length) await sb().from("invoice_items").insert(itemRows);
  return toInvoice(data);
}

export async function listInvoices(q?: string, clientId?: string): Promise<StoredInvoice[]> {
  let query = sb().from("invoices").select("*").order("created_at", { ascending: false });
  if (clientId) query = query.eq("client_id", clientId);
  const { data } = await query;
  const list = (data ?? []).map(toInvoice);
  if (!q) return list;
  const s = normKey(q);
  const ids = list.map((i) => i.id);
  const { data: items } = await sb().from("invoice_items").select("invoice_id,description,category_name").in("invoice_id", ids);
  const byInv = new Map<string, any[]>();
  for (const it of items ?? []) { const a = byInv.get(it.invoice_id) || []; a.push(it); byInv.set(it.invoice_id, a); }
  return list.filter((inv) => {
    const hay = [inv.supplier_name, inv.invoice_number, inv.supplier_vat, inv.invoice_date, inv.client_name,
      ...(byInv.get(inv.id) || []).flatMap((it) => [it.description, it.category_name])].filter(Boolean).join(" ");
    return normKey(hay).includes(s);
  });
}

export async function getInvoice(id: string): Promise<{ invoice: StoredInvoice; items: StoredItem[] } | null> {
  const { data: inv } = await sb().from("invoices").select("*").eq("id", id).maybeSingle();
  if (!inv) return null;
  const { data: items } = await sb().from("invoice_items").select("*").eq("invoice_id", id);
  return { invoice: toInvoice(inv), items: (items ?? []) as StoredItem[] };
}

async function recomputeInvoiceTotals(id: string) {
  const { data: items } = await sb().from("invoice_items").select("*").eq("invoice_id", id);
  let total = 0;
  for (const it of items ?? []) {
    const cv = itemCredit(it);
    if (Number(it.credit_value) !== Number(cv.toFixed(2))) await sb().from("invoice_items").update({ credit_value: Number(cv.toFixed(2)) }).eq("id", it.id);
    total += cv;
  }
  await sb().from("invoices").update({ total_credit: Number(total.toFixed(2)) }).eq("id", id);
}

export async function updateInvoiceCredits(invoiceId: string, credits: Record<string, boolean>) {
  for (const [itemId, val] of Object.entries(credits)) await sb().from("invoice_items").update({ take_credit: val }).eq("id", itemId);
  await recomputeInvoiceTotals(invoiceId);
  return getInvoice(invoiceId);
}

export async function updateInvoice(invoiceId: string, patch: { header?: Partial<StoredInvoice>; items?: Array<Partial<StoredItem> & { id: string }> }) {
  if (patch.header) {
    const h: any = { ...patch.header };
    if ("document_file" in h) { h.document_path = h.document_file; delete h.document_file; }
    const allowed = ["supplier_name","store_name","supplier_vat","invoice_number","barcode","invoice_date","posting_date","invoice_time","doc_type","total_net","total_vat","total_gross","document_path"];
    const row: any = {};
    for (const k of allowed) if (k in h) row[k] = h[k];
    if (Object.keys(row).length) await sb().from("invoices").update(row).eq("id", invoiceId);
  }
  if (patch.items) {
    const { data: invRow } = await sb().from("invoices").select("client_id").eq("id", invoiceId).maybeSingle();
    const clientId = invRow?.client_id as string | null;
    for (const upd of patch.items) {
      const row: any = {};
      for (const k of ["description","quantity","net_amount","vat_rate_on_invoice","expected_vat_rate","category_code","category_name","account_code","account_name","take_credit"])
        if (k in upd) row[k] = (upd as any)[k];
      if (Object.keys(row).length) await sb().from("invoice_items").update(row).eq("id", upd.id);
      if ("category_code" in upd || "category_name" in upd || "expected_vat_rate" in upd) {
        const { data: it } = await sb().from("invoice_items").select("master_item_id,category_code,category_name,expected_vat_rate").eq("id", upd.id).maybeSingle();
        if (it?.master_item_id) await sb().from("items_master").update({ category_code: it.category_code, category_name: it.category_name, expected_vat_rate: it.expected_vat_rate, last_seen: new Date().toISOString() }).eq("id", it.master_item_id);
      }
      if (clientId && ("account_code" in upd || "account_name" in upd)) {
        const { data: it } = await sb().from("invoice_items").select("description,account_code,account_name").eq("id", upd.id).maybeSingle();
        if (it && (it.account_code || it.account_name)) await teachAccount(clientId, it.description, it.account_code, it.account_name);
      }
    }
  }
  await recomputeInvoiceTotals(invoiceId);
  return getInvoice(invoiceId);
}

export async function deleteInvoice(id: string): Promise<boolean> {
  const { data: inv } = await sb().from("invoices").select("document_path").eq("id", id).maybeSingle();
  if (inv?.document_path) { try { await sb().storage.from(BUCKET).remove([inv.document_path]); } catch {} }
  const { error } = await sb().from("invoices").delete().eq("id", id);
  return !error;
}

export async function getDocumentDownload(id: string): Promise<{ bytes: Buffer; ext: string } | null> {
  const { data: inv } = await sb().from("invoices").select("document_path").eq("id", id).maybeSingle();
  if (!inv?.document_path) return null;
  const { data, error } = await sb().storage.from(BUCKET).download(inv.document_path);
  if (error || !data) return null;
  const ext = inv.document_path.split(".").pop()?.toLowerCase() || "bin";
  const bytes = Buffer.from(await data.arrayBuffer());
  return { bytes, ext };
}

// ---------------- Obligations ----------------
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function inputVatInPeriod(clientId: string, start: string, end: string): Promise<number> {
  // Aggregate by posting date (data de lançamento / competência), fallback invoice_date.
  const { data } = await sb().from("invoices").select("total_credit,posting_date,invoice_date").eq("client_id", clientId);
  const sum = (data ?? []).reduce((a: number, i: any) => {
    const d = i.posting_date || i.invoice_date;
    return d && d >= start && d <= end ? a + (i.total_credit || 0) : a;
  }, 0);
  return Number(sum.toFixed(2));
}
async function salesVatInPeriod(clientId: string, start: string, end: string): Promise<number> {
  const { data } = await sb().from("sales").select("vat_amount,entry_date").eq("client_id", clientId).gte("entry_date", start).lte("entry_date", end);
  return Number((data ?? []).reduce((a: number, s: any) => a + (s.vat_amount || 0), 0).toFixed(2));
}

export async function getObligations(clientId: string, year: number): Promise<ClientObligation[]> {
  const { data: existing } = await sb().from("obligations").select("*").eq("client_id", clientId).eq("year", year).order("period_start");
  if (existing && existing.length) return existing as ClientObligation[];
  const rows: any[] = [];
  for (let m = 0; m < 12; m += 2) {
    const start = new Date(Date.UTC(year, m, 1)), end = new Date(Date.UTC(year, m + 2, 0)), due = new Date(Date.UTC(year, m + 2, 23));
    const purchases = await inputVatInPeriod(clientId, iso(start), iso(end));
    const sales = await salesVatInPeriod(clientId, iso(start), iso(end));
    rows.push({ client_id: clientId, kind: "VAT3", period_label: `${MONTHS[m]}–${MONTHS[m + 1]} ${year}`,
      period_start: iso(start), period_end: iso(end), due_date: iso(due), year, status: "open",
      vat_on_sales: sales || null, vat_on_purchases: purchases, net: sales || purchases ? Number((sales - purchases).toFixed(2)) : null });
  }
  const rStart = new Date(Date.UTC(year, 0, 1)), rEnd = new Date(Date.UTC(year, 11, 31));
  rows.push({ client_id: clientId, kind: "RTD", period_label: `RTD ${year}`, period_start: iso(rStart), period_end: iso(rEnd),
    due_date: iso(new Date(Date.UTC(year + 1, 0, 23))), year, status: "open",
    vat_on_sales: (await salesVatInPeriod(clientId, iso(rStart), iso(rEnd))) || null,
    vat_on_purchases: await inputVatInPeriod(clientId, iso(rStart), iso(rEnd)), net: null });
  const { data } = await sb().from("obligations").insert(rows).select().order("period_start");
  return (data ?? []) as ClientObligation[];
}

export async function refreshObligations(clientId: string, year: number): Promise<ClientObligation[]> {
  const list = await getObligations(clientId, year);
  for (const o of list) {
    if (o.status === "filed") continue;
    const purchases = await inputVatInPeriod(clientId, o.period_start, o.period_end);
    const sv = await salesVatInPeriod(clientId, o.period_start, o.period_end);
    const sales = sv || o.vat_on_sales || 0;
    const net = Number((sales - purchases).toFixed(2));
    await sb().from("obligations").update({ vat_on_purchases: purchases, vat_on_sales: sv || o.vat_on_sales, net }).eq("id", o.id);
  }
  const { data } = await sb().from("obligations").select("*").eq("client_id", clientId).eq("year", year).order("period_start");
  return (data ?? []) as ClientObligation[];
}

export async function updateObligation(id: string, patch: Partial<ClientObligation>): Promise<ClientObligation | null> {
  const { data: o } = await sb().from("obligations").select("*").eq("id", id).maybeSingle();
  if (!o) return null;
  const row: any = {};
  if (patch.vat_on_sales !== undefined) row.vat_on_sales = patch.vat_on_sales;
  if (patch.vat_on_purchases !== undefined) row.vat_on_purchases = patch.vat_on_purchases;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.status !== undefined) { row.status = patch.status; row.filed_at = patch.status === "filed" ? new Date().toISOString() : null; }
  const sales = row.vat_on_sales ?? o.vat_on_sales, purch = row.vat_on_purchases ?? o.vat_on_purchases;
  row.net = sales != null || purch != null ? Number(((sales || 0) - (purch || 0)).toFixed(2)) : null;
  const { data } = await sb().from("obligations").update(row).eq("id", id).select().maybeSingle();
  return (data as ClientObligation) ?? null;
}

export async function monthlySeries(clientId: string, year: number) {
  const { data } = await sb().from("invoices").select("invoice_date,posting_date,total_gross,total_credit").eq("client_id", clientId);
  const months = Array.from({ length: 12 }, (_, m) => ({ month: MONTHS[m], gross: 0, credit: 0, count: 0 }));
  for (const inv of data ?? []) {
    const d = inv.posting_date || inv.invoice_date;
    if (!d || !String(d).startsWith(String(year))) continue;
    const m = Number(String(d).slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    months[m].gross += inv.total_gross || 0; months[m].credit += inv.total_credit || 0; months[m].count += 1;
  }
  return months.map((x) => ({ ...x, gross: Number(x.gross.toFixed(2)), credit: Number(x.credit.toFixed(2)) }));
}

// ---------------- VAT by rate (entradas/saídas por alíquota) ----------------
const r2 = (n: number) => Number(n.toFixed(2));

export interface RateDoc { id: string; label: string; date: string | null; net: number; vat: number; }
export interface RateGroup { rate: number; net: number; vat: number; credit?: number; count: number; docs: RateDoc[]; }

export async function vatByRate(clientId: string, start: string, end: string): Promise<{ purchases: RateGroup[]; sales: RateGroup[] }> {
  // ---- Purchases (entradas): group invoice_items by expected rate ----
  const { data: invs } = await sb().from("invoices")
    .select("id,supplier_name,invoice_number,invoice_date,posting_date").eq("client_id", clientId);
  const inPeriod = (invs ?? []).filter((i: any) => { const d = i.posting_date || i.invoice_date; return d && d >= start && d <= end; });
  const invMap = new Map(inPeriod.map((i: any) => [i.id, i]));
  const ids = inPeriod.map((i: any) => i.id);
  let items: any[] = [];
  if (ids.length) {
    const { data } = await sb().from("invoice_items")
      .select("invoice_id,net_amount,vat_amount_on_invoice,expected_vat_rate,vat_rate_on_invoice,credit_value").in("invoice_id", ids);
    items = data ?? [];
  }
  const pMap = new Map<number, { rate: number; net: number; vat: number; credit: number; docs: Map<string, { net: number; vat: number }> }>();
  for (const it of items) {
    const rate = Number(it.expected_vat_rate ?? it.vat_rate_on_invoice ?? 0);
    const net = Number(it.net_amount || 0);
    const vat = it.vat_amount_on_invoice != null ? Number(it.vat_amount_on_invoice)
      : (it.net_amount != null && it.expected_vat_rate != null ? net * Number(it.expected_vat_rate) / 100 : 0);
    const g = pMap.get(rate) || { rate, net: 0, vat: 0, credit: 0, docs: new Map() };
    g.net += net; g.vat += vat; g.credit += Number(it.credit_value || 0);
    const d = g.docs.get(it.invoice_id) || { net: 0, vat: 0 }; d.net += net; d.vat += vat; g.docs.set(it.invoice_id, d);
    pMap.set(rate, g);
  }
  const purchases: RateGroup[] = Array.from(pMap.values()).sort((a, b) => b.rate - a.rate).map((g) => ({
    rate: g.rate, net: r2(g.net), vat: r2(g.vat), credit: r2(g.credit), count: g.docs.size,
    docs: Array.from(g.docs.entries()).map(([id, v]) => {
      const inv: any = invMap.get(id);
      return { id, label: [inv?.supplier_name, inv?.invoice_number].filter(Boolean).join(" · ") || "—", date: inv?.posting_date || inv?.invoice_date || null, net: r2(v.net), vat: r2(v.vat) };
    }),
  }));

  // ---- Sales (saídas): group sales by rate ----
  const { data: sales } = await sb().from("sales")
    .select("id,entry_date,doc_number,customer,net_amount,vat_rate,vat_amount").eq("client_id", clientId).gte("entry_date", start).lte("entry_date", end);
  const sMap = new Map<number, { rate: number; net: number; vat: number; docs: RateDoc[] }>();
  for (const s of sales ?? []) {
    const rate = Number(s.vat_rate ?? 0);
    const g = sMap.get(rate) || { rate, net: 0, vat: 0, docs: [] };
    g.net += Number(s.net_amount || 0); g.vat += Number(s.vat_amount || 0);
    g.docs.push({ id: s.id, label: [s.doc_number, s.customer].filter(Boolean).join(" · ") || "—", date: s.entry_date, net: r2(Number(s.net_amount || 0)), vat: r2(Number(s.vat_amount || 0)) });
    sMap.set(rate, g);
  }
  const salesByRate: RateGroup[] = Array.from(sMap.values()).sort((a, b) => b.rate - a.rate).map((g) => ({
    rate: g.rate, net: r2(g.net), vat: r2(g.vat), count: g.docs.length, docs: g.docs,
  }));

  return { purchases, sales: salesByRate };
}

// Full export payload for a client + year (Excel/PDF build on the client)
export async function exportData(clientId: string, year: number) {
  const client = await getClient(clientId);
  const start = `${year}-01-01`, end = `${year}-12-31`;
  const allInv = await listInvoices(undefined, clientId);
  const invoices = allInv.filter((i) => { const d = i.posting_date || i.invoice_date; return d ? String(d).startsWith(String(year)) : true; });
  const ids = invoices.map((i) => i.id);
  let items: StoredItem[] = [];
  if (ids.length) {
    const { data } = await sb().from("invoice_items").select("*").in("invoice_id", ids);
    items = (data ?? []) as StoredItem[];
  }
  const obligations = await getObligations(clientId, year);
  const rates = await vatByRate(clientId, start, end);
  const series = await monthlySeries(clientId, year);
  return { client, year, invoices, items, obligations, rates, series };
}

// ---------------- Sales ----------------
export async function listSales(clientId: string): Promise<SalesEntry[]> {
  const { data } = await sb().from("sales").select("*").eq("client_id", clientId).order("entry_date", { ascending: false });
  return (data ?? []) as SalesEntry[];
}
export async function addSalesEntries(clientId: string, rows: Array<Partial<SalesEntry>>): Promise<SalesEntry[]> {
  const toInsert = rows.filter((r) => r.entry_date).map((r) => {
    const net = r.net_amount ?? null, rate = r.vat_rate ?? null;
    const vat = r.vat_amount != null ? Number(r.vat_amount) : net != null && rate != null ? Number(((net * rate) / 100).toFixed(2)) : 0;
    return { client_id: clientId, entry_date: r.entry_date, doc_number: r.doc_number ?? null, customer: r.customer ?? null,
      net_amount: net, vat_rate: rate, vat_amount: Number(vat.toFixed(2)), notes: r.notes ?? null };
  });
  if (!toInsert.length) return [];
  const { data } = await sb().from("sales").insert(toInsert).select();
  return (data ?? []) as SalesEntry[];
}
export async function deleteSalesEntry(id: string): Promise<boolean> {
  const { error } = await sb().from("sales").delete().eq("id", id);
  return !error;
}

// ---------------- Chart of accounts (per client) ----------------
export async function listAccounts(clientId: string): Promise<ChartAccount[]> {
  const { data } = await sb().from("chart_of_accounts").select("*").eq("client_id", clientId).order("code");
  return (data ?? []) as ChartAccount[];
}
export async function createAccount(clientId: string, input: Partial<ChartAccount>): Promise<ChartAccount | null> {
  const row = {
    client_id: clientId,
    code: (input.code || "").trim(),
    description: (input.description || "").trim(),
    parent_code: input.parent_code?.trim() || null,
    active: input.active !== false,
  };
  if (!row.code) return null;
  const { data, error } = await sb().from("chart_of_accounts")
    .upsert(row, { onConflict: "client_id,code" }).select().single();
  if (error) throw error;
  return data as ChartAccount;
}
export async function updateAccount(id: string, patch: Partial<ChartAccount>): Promise<ChartAccount | null> {
  const row: any = {};
  for (const k of ["code", "description", "parent_code", "active"]) if (k in patch) row[k] = (patch as any)[k];
  const { data } = await sb().from("chart_of_accounts").update(row).eq("id", id).select().maybeSingle();
  return (data as ChartAccount) ?? null;
}
export async function deleteAccount(id: string): Promise<boolean> {
  const { error } = await sb().from("chart_of_accounts").delete().eq("id", id);
  return !error;
}
export async function bulkImportAccounts(clientId: string, rows: Array<{ code: string; description: string; parent_code?: string | null }>): Promise<number> {
  const clean = rows
    .map((r) => ({
      client_id: clientId,
      code: String(r.code ?? "").trim(),
      description: String(r.description ?? "").trim(),
      parent_code: r.parent_code ? String(r.parent_code).trim() : null,
      active: true,
    }))
    .filter((r) => r.code);
  if (!clean.length) return 0;
  // de-dup by code within the batch (keep last)
  const byCode = new Map<string, any>();
  for (const r of clean) byCode.set(r.code, r);
  const list = Array.from(byCode.values());
  const { error } = await sb().from("chart_of_accounts").upsert(list, { onConflict: "client_id,code" });
  if (error) throw error;
  return list.length;
}

// Per-client learned item -> account mapping (de-para de conta)
export async function learnedAccounts(clientId: string, descriptions: string[]): Promise<Record<string, { code: string | null; name: string | null }>> {
  const keys = Array.from(new Set(descriptions.map(normKey)));
  if (!keys.length) return {};
  const { data } = await sb().from("client_item_accounts").select("norm_key,account_code,account_name").eq("client_id", clientId).in("norm_key", keys);
  const out: Record<string, { code: string | null; name: string | null }> = {};
  for (const r of data ?? []) out[r.norm_key] = { code: r.account_code, name: r.account_name };
  return out;
}
async function teachAccount(clientId: string, description: string, code: string | null, name: string | null) {
  if (!clientId || (!code && !name)) return;
  const key = normKey(description);
  const { data: existing } = await sb().from("client_item_accounts").select("id,occurrences").eq("client_id", clientId).eq("norm_key", key).maybeSingle();
  if (existing) {
    await sb().from("client_item_accounts").update({ account_code: code, account_name: name, occurrences: (existing.occurrences || 0) + 1, updated_at: new Date().toISOString() }).eq("id", existing.id);
  } else {
    await sb().from("client_item_accounts").insert({ client_id: clientId, norm_key: key, account_code: code, account_name: name });
  }
}

// ---------------- Auth users ----------------
export async function findAppUserByEmail(email: string): Promise<AppUser | null> {
  const { data } = await sb().from("app_users").select("*").eq("email", email.toLowerCase().trim()).eq("active", true).maybeSingle();
  return (data as AppUser) ?? null;
}

// ---------------- Stats ----------------
export async function stats(clientId?: string) {
  let iq = sb().from("invoices").select("id,total_gross,total_credit");
  if (clientId) iq = iq.eq("client_id", clientId);
  const [{ data: invs }, { count: clientsCount }, { count: itemsCount }, { count: masterCount }] = await Promise.all([
    iq,
    sb().from("clients").select("*", { count: "exact", head: true }),
    sb().from("invoice_items").select("*", { count: "exact", head: true }),
    sb().from("items_master").select("*", { count: "exact", head: true }),
  ]);
  const list = invs ?? [];
  return {
    invoices: list.length,
    items: itemsCount ?? 0,
    unique_items: masterCount ?? 0,
    clients: clientsCount ?? 0,
    total_credit: Number(list.reduce((a: number, i: any) => a + (i.total_credit || 0), 0).toFixed(2)),
    total_gross: Number(list.reduce((a: number, i: any) => a + (i.total_gross || 0), 0).toFixed(2)),
  };
}
