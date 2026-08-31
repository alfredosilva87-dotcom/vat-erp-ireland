import { randomUUID } from "crypto";
import { impedimentoParaApagar, impedimentoParaEditar } from "@/lib/financial/devolver";
import { getServerSupabase } from "@/lib/supabase";
import { computeLines } from "@/lib/vat";
import { diffFields, recordAudit, type Actor, type AuditAction } from "@/lib/reviewStore";
import { checkFit, verifyLicenseKey } from "@/lib/licenseKey";
import type {
  StoredInvoice, StoredItem, MasterItem, Client, ClientWithStats,
  CreditRule, ClientObligation, SalesEntry, AppUser, ChartAccount, Branch, Company,
  RecurringObligation,
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
// Tenant isolation happens here. Every other table hangs off clients.client_id,
// so scoping the client list (and the id lookup) by company keeps a whole
// tenant separate without touching the rest of the queries.
export async function listClients(q?: string, companyId?: string | null): Promise<Client[]> {
  let query = sb().from("clients").select("*").order("name");
  if (companyId) query = query.eq("company_id", companyId);
  const { data } = await query;
  const list = (data ?? []) as Client[];
  if (!q) return list;
  const s = normKey(q);
  return list.filter((c) =>
    normKey([c.name, c.client_code, c.vat_number, c.tax_reg_no, c.email].filter(Boolean).join(" ")).includes(s)
  );
}
export async function getClient(id: string, companyId?: string | null): Promise<Client | null> {
  let query = sb().from("clients").select("*").eq("id", id);
  if (companyId) query = query.eq("company_id", companyId);
  const { data } = await query.maybeSingle();
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
    default_credit_unmatched: input.default_credit_unmatched ?? false,
    related_categories: input.related_categories ?? [],
    company_id: (input as any).company_id ?? null,
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
  // Lista branca, e não `...patch`: o corpo vem do navegador, e sem ela um
  // pedido feito à mão escrevia qualquer coluna da tabela — `company_id` incluído.
  for (const k of ["name","trading_name","legal_form","director","vat_number","tax_reg_no","cro","activity_code","activity_label","default_credit_unmatched","related_categories","email","phone","address","notes","invoice_footer","invoice_bank_account_id"])
    if (k in patch) row[k] = (patch as any)[k];
  const { data } = await sb().from("clients").update(row).eq("id", id).select().maybeSingle();
  return (data as Client) ?? null;
}
export async function deleteClient(id: string): Promise<boolean> {
  const { error } = await sb().from("clients").delete().eq("id", id);
  return !error;
}
export async function clientsWithStats(q?: string, companyId?: string | null): Promise<ClientWithStats[]> {
  const clients = await listClients(q, companyId);
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
  description: string; quantity: number | null; unit_price: number | null; net_amount: number | null;
  vat_rate_on_invoice: number | null; vat_amount_on_invoice: number | null; expected_vat_rate: number | null;
  category_code: string | null; category_name: string | null; take_credit: boolean;
  /** Conta já decidida por regra de fornecedor (camada B1). Ver saveInvoice. */
  account_code?: string | null; account_name?: string | null;
}
export interface SavePayload {
  client_id: string | null; branch_id: string | null; activity_code: string; engine: string; original_filename: string | null;
  /** Por onde o documento entrou: "upload" | "email" | "phone". Ver 013_invoice_source.sql. */
  source?: string | null;
  /** Quando o documento CHEGOU (não quando foi gravado). Ver 015_captured_at.sql. */
  captured_at?: string | null;
  /** O que a leitura disse que ele é (nota, recibo, planilha, ilegível…). */
  doc_kind?: string | null;
  confidence: number; needs_review: boolean; issues: string[];
  audit?: { engine: string; confidence: number }[];
  header: {
    supplier_name: string | null; store_name: string | null; supplier_vat: string | null;
    invoice_number: string | null; barcode: string | null; invoice_date: string | null;
    posting_date: string | null; invoice_time: string | null; doc_type: string;
    total_net: number | null; total_vat: number | null; total_gross: number | null;
  };
  items: SaveItem[];
}
/**
 * Credit per line for a whole invoice at once.
 *
 * This has to see every line plus the document totals: receipts print
 * VAT-inclusive prices, so the VAT has to be extracted from the amount rather
 * than added on top, and the lines are then anchored to the VAT the supplier
 * actually stated. See lib/vat.ts.
 */
function creditsForInvoice(
  items: { take_credit: boolean; vat_amount_on_invoice: number | null; net_amount: number | null; vat_rate_on_invoice?: number | null; expected_vat_rate: number | null }[],
  totals: { total_net: number | null; total_vat: number | null; total_gross: number | null }
): number[] {
  const { lines } = computeLines(items, totals);
  return items.map((it, i) => (it.take_credit ? lines[i].vat : 0));
}

export async function saveInvoice(
  payload: SavePayload, fileBuffer: Buffer | null, ext: string, actor: Actor = null
): Promise<StoredInvoice> {
  const id = randomUUID();
  const client = payload.client_id ? await getClient(payload.client_id) : null;
  let branchName: string | null = null;
  if (payload.branch_id) {
    const { data: b } = await sb().from("branches").select("name").eq("id", payload.branch_id).maybeSingle();
    branchName = b?.name ?? null;
  }

  let documentPath: string | null = null;
  if (fileBuffer) {
    const safeExt = (ext || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
    const path = `${id}.${safeExt}`;
    const ct = safeExt === "pdf" ? "application/pdf" : `image/${safeExt === "jpg" ? "jpeg" : safeExt}`;
    const { error } = await sb().storage.from(BUCKET).upload(path, fileBuffer, { contentType: ct, upsert: true });
    if (!error) documentPath = path;
  }

  // Conta contábil: REGRA DE FORNECEDOR primeiro, memória item→conta depois.
  //
  // Essa ordem é a precedência da camada B1 (ver lib/supplierRules.ts). Antes
  // daqui a memória era a única fonte e sobrescrevia tudo, então uma regra de
  // fornecedor recém-escrita não teria efeito nenhum na gravação — o defeito
  // mais mudo possível, porque a regra está na tela, certa, e a nota chega com
  // outra conta.
  //
  // A memória é consultada só para o que ainda não tem conta, o que também
  // evita a consulta inteira quando a regra resolveu todas as linhas.
  const needLearned = payload.items.filter((i) => !i.account_code && !i.account_name).map((i) => i.description);
  const learned = client && needLearned.length ? await learnedAccounts(client.id, needLearned) : {};

  const credits = creditsForInvoice(payload.items, {
    total_net: payload.header.total_net,
    total_vat: payload.header.total_vat,
    total_gross: payload.header.total_gross,
  });

  let totalCredit = 0;
  const itemRows: any[] = [];
  for (let idx = 0; idx < payload.items.length; idx++) {
    const it = payload.items[idx];
    const masterId = await findOrCreateMaster(it.description, it.category_code, it.category_name, it.expected_vat_rate);
    const cv = credits[idx];
    totalCredit += cv;
    const acc = it.account_code || it.account_name
      ? { code: it.account_code ?? null, name: it.account_name ?? null }
      : learned[normKey(it.description)] || { code: null, name: null };
    itemRows.push({
      invoice_id: id, master_item_id: masterId, description: it.description, quantity: it.quantity,
      unit_price: it.unit_price,
      net_amount: it.net_amount, vat_rate_on_invoice: it.vat_rate_on_invoice, vat_amount_on_invoice: it.vat_amount_on_invoice,
      expected_vat_rate: it.expected_vat_rate, category_code: it.category_code, category_name: it.category_name,
      account_code: acc.code, account_name: acc.name,
      take_credit: it.take_credit, credit_value: Number(cv.toFixed(2)),
    });
  }

  const invRow = {
    id, client_id: client?.id ?? null, client_code: client?.client_code ?? null, client_name: client?.name ?? null,
    branch_id: payload.branch_id ?? null, branch_name: branchName,
    activity_code: payload.activity_code, supplier_name: payload.header.supplier_name, store_name: payload.header.store_name,
    supplier_vat: payload.header.supplier_vat, invoice_number: payload.header.invoice_number, barcode: payload.header.barcode,
    invoice_date: payload.header.invoice_date, posting_date: payload.header.posting_date || new Date().toISOString().slice(0, 10),
    invoice_time: payload.header.invoice_time, doc_type: payload.header.doc_type,
    currency: "EUR", total_net: payload.header.total_net, total_vat: payload.header.total_vat, total_gross: payload.header.total_gross,
    total_credit: Number(totalCredit.toFixed(2)), engine: payload.engine, original_filename: payload.original_filename,
    source: payload.source ?? null,
    // Sem carimbo de chegada usa o de agora: a nota escolhida à mão chega e é
    // gravada no mesmo gesto, então os dois momentos coincidem de verdade.
    captured_at: payload.captured_at ?? new Date().toISOString(),
    doc_kind: payload.doc_kind ?? null,
    document_path: documentPath, item_count: payload.items.length,
    extraction_confidence: payload.confidence, needs_review: payload.needs_review, review_notes: payload.issues,
    extraction_audit: payload.audit ?? [],
  };
  const { data, error } = await sb().from("invoices").insert(invRow).select().single();
  if (error) throw error;
  if (itemRows.length) await sb().from("invoice_items").insert(itemRows);

  // O começo da trilha. Sem esta linha, a primeira entrada do histórico de uma
  // nota seria a primeira correção — e ficaria sem dizer de onde ela veio, nem
  // quem a lançou.
  await recordAudit(id, actor, [{
    action: "created",
    note: [
      payload.original_filename,
      payload.engine ? `lido por ${payload.engine}` : null,
      `${payload.items.length} linha(s)`,
    ].filter(Boolean).join(" · "),
  }]);

  return toInvoice(data);
}

export interface InvoiceFilter {
  q?: string;
  clientId?: string;
  /**
   * Os clientes que quem pediu pode ver (camada de acesso, lib/access.ts).
   * `undefined` = sem recorte, usado só por caminho interno; a rota SEMPRE passa
   * a lista, porque sem ela a consulta devolve as notas de todos os escritórios.
   */
  allowedClientIds?: string[] | null;
  branchId?: string;
  /** Inclusive yyyy-mm-dd bounds on posting_date (falling back to invoice_date). */
  start?: string;
  end?: string;
  needsReview?: boolean;
  /** Restrict to exactly these invoices — used to review a just-imported batch. */
  ids?: string[];
}

export async function listInvoices(
  q?: string | InvoiceFilter,
  clientId?: string,
  branchId?: string
): Promise<StoredInvoice[]> {
  // Accepts either the original positional args or a filter object.
  const f: InvoiceFilter = typeof q === "object" && q !== null ? q : { q, clientId, branchId };

  let query = sb().from("invoices").select("*").order("created_at", { ascending: false });
  if (f.clientId) query = query.eq("client_id", f.clientId);
  // Recorte por empresa. Uma nota sem cliente não pertence a escritório nenhum e
  // fica de fora quando há recorte — é dado solto, e num sistema multiempresa não
  // há como dizer de quem é.
  else if (f.allowedClientIds) query = query.in("client_id", f.allowedClientIds.length ? f.allowedClientIds : ["00000000-0000-0000-0000-000000000000"]);
  if (f.branchId) query = query.eq("branch_id", f.branchId);
  if (f.needsReview) query = query.eq("needs_review", true);
  if (f.ids?.length) query = query.in("id", f.ids);
  const { data } = await query;

  let list = (data ?? []).map(toInvoice);

  // Date filtering happens here (not in SQL) because the effective date is
  // posting_date with invoice_date as fallback.
  if (f.start || f.end) {
    list = list.filter((i) => {
      const d = i.posting_date || i.invoice_date;
      if (!d) return false;
      if (f.start && d < f.start) return false;
      if (f.end && d > f.end) return false;
      return true;
    });
  }

  if (!f.q) return list;
  const s = normKey(f.q);
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

export async function recomputeInvoiceTotals(id: string) {
  const [{ data: items }, { data: inv }] = await Promise.all([
    sb().from("invoice_items").select("*").eq("invoice_id", id).order("id"),
    sb().from("invoices").select("total_net,total_vat,total_gross").eq("id", id).maybeSingle(),
  ]);
  const list = items ?? [];
  const credits = creditsForInvoice(list as any, {
    total_net: (inv as any)?.total_net ?? null,
    total_vat: (inv as any)?.total_vat ?? null,
    total_gross: (inv as any)?.total_gross ?? null,
  });

  let total = 0;
  for (let i = 0; i < list.length; i++) {
    const cv = Number(credits[i].toFixed(2));
    if (Number((list[i] as any).credit_value) !== cv) {
      await sb().from("invoice_items").update({ credit_value: cv }).eq("id", (list[i] as any).id);
    }
    total += cv;
  }
  await sb().from("invoices").update({ total_credit: Number(total.toFixed(2)), item_count: list.length }).eq("id", id);
}

export async function updateInvoiceCredits(invoiceId: string, credits: Record<string, boolean>) {
  for (const [itemId, val] of Object.entries(credits)) await sb().from("invoice_items").update({ take_credit: val }).eq("id", itemId);
  await recomputeInvoiceTotals(invoiceId);
  return getInvoice(invoiceId);
}

/** Campos do cabeçalho que a trilha acompanha, na ordem em que aparecem na tela. */
const AUDITED_HEADER = [
  "supplier_name", "store_name", "supplier_vat", "invoice_number", "barcode",
  "invoice_date", "posting_date", "invoice_time", "doc_type",
  "total_net", "total_vat", "total_gross", "branch_id",
];
const AUDITED_ITEM = [
  "description", "quantity", "unit_price", "net_amount", "vat_rate_on_invoice",
  "expected_vat_rate", "category_code", "account_code", "take_credit",
];

/**
 * Altera a nota e **grava a trilha no mesmo caminho**.
 *
 * A trilha ficar aqui, e não numa chamada que a rota precisa lembrar de fazer, é
 * o que garante que ela não tem buracos (camada B3). Uma trilha que depende de a
 * interface colaborar vale menos que nenhuma, porque dá impressão de cobertura.
 */
export async function updateInvoice(
  invoiceId: string,
  patch: { header?: Partial<StoredInvoice>; items?: Array<Partial<StoredItem> & { id: string }> },
  actor: Actor = null
) {
  const audit: Array<{ action: AuditAction; field?: string | null; old?: unknown; new?: unknown; note?: string | null }> = [];

  if (patch.header) {
    const h: any = { ...patch.header };
    if ("document_file" in h) { h.document_path = h.document_file; delete h.document_file; }
    if ("branch_id" in h) {
      if (h.branch_id) { const { data: b } = await sb().from("branches").select("name").eq("id", h.branch_id).maybeSingle(); h.branch_name = b?.name ?? null; }
      else h.branch_name = null;
    }
    const allowed = ["supplier_name","store_name","supplier_vat","invoice_number","barcode","invoice_date","posting_date","invoice_time","doc_type","total_net","total_vat","total_gross","document_path","branch_id","branch_name","needs_review"];
    const row: any = {};
    for (const k of allowed) if (k in h) row[k] = h[k];
    if (Object.keys(row).length) {
      // Lido ANTES de escrever: é a única hora em que o valor antigo existe.
      const { data: before } = await sb()
        .from("invoices").select(AUDITED_HEADER.join(",")).eq("id", invoiceId).maybeSingle();

      /*
       * Num documento integrado, valor e data não se mexem — ver
       * `impedimentoParaEditar`. A conferência usa o que MUDA de facto: uma
       * gravação que reenvia o mesmo número não é alteração nenhuma, e recusar
       * por causa dela faria a tela ficar impossível de usar.
       */
      const mudam = diffFields((before ?? {}) as any, row, AUDITED_HEADER).map((d) => d.field);
      if (mudam.length) {
        const { data: dono } = await sb().from("invoices")
          .select("client_id").eq("id", invoiceId).maybeSingle();
        const cid = (dono as any)?.client_id as string | null;
        if (cid) {
          const impedimento = await impedimentoParaEditar(cid, invoiceId, "purchase", mudam);
          if (impedimento) throw new Error(impedimento);
        }
      }

      await sb().from("invoices").update(row).eq("id", invoiceId);
      for (const d of diffFields((before ?? {}) as any, row, AUDITED_HEADER)) {
        audit.push({ action: "edited", field: d.field, old: d.old, new: d.new });
      }
    }
  }
  if (patch.items) {
    const { data: invRow } = await sb().from("invoices").select("client_id").eq("id", invoiceId).maybeSingle();
    const clientId = invRow?.client_id as string | null;
    for (const upd of patch.items) {
      // Lines added on the invoice-edit screen (e.g. to compensate for a
      // missing page/item) carry a client-generated "new-" id instead of a
      // real invoice_items id — insert them instead of updating.
      if (upd.id.startsWith("new-")) {
        const row: any = { invoice_id: invoiceId, take_credit: false };
        for (const k of ["description","quantity","unit_price","net_amount","vat_rate_on_invoice","expected_vat_rate","category_code","category_name","account_code","account_name","take_credit"])
          if (k in upd) row[k] = (upd as any)[k];
        if (!row.description) continue; // nothing to save yet
        await sb().from("invoice_items").insert(row);
        audit.push({ action: "item_added", field: "description", new: row.description,
          note: row.net_amount != null ? `Valor ${row.net_amount}` : null });
        continue;
      }
      const row: any = {};
      for (const k of ["description","quantity","unit_price","net_amount","vat_rate_on_invoice","expected_vat_rate","category_code","category_name","account_code","account_name","take_credit"])
        if (k in upd) row[k] = (upd as any)[k];
      if (Object.keys(row).length) {
        const { data: beforeItem } = await sb()
          .from("invoice_items").select(["description", ...AUDITED_ITEM].join(",")).eq("id", upd.id).maybeSingle();
        await sb().from("invoice_items").update(row).eq("id", upd.id);
        const label = (beforeItem as any)?.description || upd.id;
        for (const d of diffFields((beforeItem ?? {}) as any, row, AUDITED_ITEM)) {
          audit.push({ action: "item_edited", field: d.field, old: d.old, new: d.new, note: label });
        }
      }
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
  await recordAudit(invoiceId, actor, audit);
  return getInvoice(invoiceId);
}

/**
 * Deletes several invoices in one go. Storage objects are removed in a single
 * call and the rows in a single statement, so a 50-invoice cleanup is two
 * round-trips instead of a hundred. Returns how many rows were removed.
 */
export async function deleteInvoices(
  ids: string[]
): Promise<{ apagadas: number; integradas: { id: string; erro: string }[] }> {
  if (!ids.length) return { apagadas: 0, integradas: [] };

  const { data: rows } = await sb().from("invoices")
    .select("id,document_path,client_id").in("id", ids);
  const todas = (rows ?? []) as any[];
  if (!todas.length) return { apagadas: 0, integradas: [] };

  /*
   * No lote, a nota integrada é SALTADA e as outras seguem.
   *
   * Recusar o lote inteiro por causa de uma faria a pessoa perder o trabalho
   * das outras 49; apagar tudo em silêncio esconderia o problema. As que
   * ficaram voltam com o motivo, para a tela poder dizer quais e porquê.
   */
  const integradas: { id: string; erro: string }[] = [];
  const livres: any[] = [];
  for (const r of todas) {
    const impedimento = r.client_id
      ? await impedimentoParaApagar(String(r.client_id), r.id, "purchase")
      : null;
    if (impedimento) integradas.push({ id: r.id, erro: impedimento });
    else livres.push(r);
  }
  const found = livres.map((r) => r.id as string);
  if (!found.length) return { apagadas: 0, integradas };

  const paths = livres.map((r: any) => r.document_path).filter(Boolean) as string[];
  if (paths.length) {
    try { await sb().storage.from(BUCKET).remove(paths); } catch { /* keep going; rows still go */ }
  }

  // O item da Caixa de entrada que virou esta nota (camada B2) precisa voltar
  // pra fila ANTES de apagar — a chave estrangeira já zera `invoice_id`
  // sozinha ao apagar a nota, mas deixa `status` parado em "saved", e um item
  // "saved" sem nota não mostra nem Ler nem Descartar: fica travado pra
  // sempre. Voltar pra "pending" é o que devolve as duas opções.
  await sb().from("inbox_items").update({ status: "pending", invoice_id: null, invoice_count: 0 }).in("invoice_id", found);

  const { error } = await sb().from("invoices").delete().in("id", found);
  return { apagadas: error ? 0 : found.length, integradas };
}

/**
 * Apaga UMA nota — se ela não estiver integrada.
 *
 * A trava vive aqui e não na tela: a rota de API responde a quem a chamar, e
 * um guarda que depende de a tela se lembrar dele tem buraco. Ver
 * `lib/financial/devolver.ts` para o porquê da ordem (devolver, depois apagar).
 */
export async function deleteInvoice(id: string): Promise<{ ok: boolean; erro?: string }> {
  const { data: inv } = await sb().from("invoices")
    .select("document_path,client_id").eq("id", id).maybeSingle();
  if (inv?.client_id) {
    const impedimento = await impedimentoParaApagar(String(inv.client_id), id, "purchase");
    if (impedimento) return { ok: false, erro: impedimento };
  }
  if (inv?.document_path) { try { await sb().storage.from(BUCKET).remove([inv.document_path]); } catch {} }
  // Mesma razão do deleteInvoices em lote: sem isto o item da fila fica
  // "saved" travado, sem ação nenhuma disponível, quando a nota que ele virou
  // é apagada.
  await sb().from("inbox_items").update({ status: "pending", invoice_id: null, invoice_count: 0 }).eq("invoice_id", id);
  const { error } = await sb().from("invoices").delete().eq("id", id);
  return error ? { ok: false, erro: error.message } : { ok: true };
}

/**
 * "No document", "document is gone" and "the file service is not answering"
 * are three different things, and collapsing them into one `null` made the
 * last one look like the first: right after the server reboots, storage takes
 * a few seconds longer than the app, and an invoice that is perfectly fine
 * would report its PDF as missing. Telling an accountant a fiscal document is
 * gone when it is merely not ready yet is the wrong answer to give.
 */
export type DocumentDownload =
  | { kind: "ok"; bytes: Buffer; ext: string }
  | { kind: "none" }
  | { kind: "unavailable"; reason: string };

export async function getDocumentDownload(id: string): Promise<DocumentDownload> {
  const { data: inv } = await sb().from("invoices").select("document_path").eq("id", id).maybeSingle();
  if (!inv?.document_path) return { kind: "none" };

  let data: Blob | null = null;
  let error: { message?: string } | null = null;
  try {
    ({ data, error } = await sb().storage.from(BUCKET).download(inv.document_path));
  } catch (e: any) {
    // Connection refused / DNS failure while the storage container is booting.
    return { kind: "unavailable", reason: e?.message || "storage unreachable" };
  }

  if (error || !data) {
    const message = error?.message || "";
    // Storage says the object genuinely is not there; anything else (service
    // down, timeout) is a temporary condition worth retrying.
    if (/not found|does not exist/i.test(message)) return { kind: "none" };
    return { kind: "unavailable", reason: message || "storage returned no data" };
  }

  const ext = inv.document_path.split(".").pop()?.toLowerCase() || "bin";
  const bytes = Buffer.from(await data.arrayBuffer());
  return { kind: "ok", bytes, ext };
}

// ---------------- Obligations ----------------
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const iso = (d: Date) => d.toISOString().slice(0, 10);

/*
 * EXPORTADAS de propósito, apesar de nascerem privadas.
 *
 * São elas que alimentam o VAT3 da tela de obrigações. A conciliação fiscal
 * confronta a declaração com o razão, e para isso tem de ler *exactamente* o
 * mesmo número que a declaração leva — não um reimplementado ao lado, que
 * concordaria com a declaração até ao dia em que uma das duas mudasse.
 *
 * Um double-check contra a própria cópia não verifica nada.
 */
export async function inputVatInPeriod(clientId: string, start: string, end: string): Promise<number> {
  // Aggregate by posting date (data de lançamento / competência), fallback invoice_date.
  const { data } = await sb().from("invoices").select("total_credit,posting_date,invoice_date").eq("client_id", clientId);
  const sum = (data ?? []).reduce((a: number, i: any) => {
    const d = i.posting_date || i.invoice_date;
    return d && d >= start && d <= end ? a + (i.total_credit || 0) : a;
  }, 0);
  return Number(sum.toFixed(2));
}
export async function salesVatInPeriod(clientId: string, start: string, end: string): Promise<number> {
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

// Monthly purchases (from invoices) AND sales (from the sales table), so the
// client overview can show money in vs money out side by side.
export async function monthlySeries(clientId: string, year: number) {
  const months = Array.from({ length: 12 }, (_, m) => ({
    month: MONTHS[m], gross: 0, credit: 0, sales: 0, salesVat: 0, count: 0,
  }));

  const { data } = await sb().from("invoices").select("invoice_date,posting_date,total_gross,total_credit").eq("client_id", clientId);
  for (const inv of data ?? []) {
    const d = inv.posting_date || inv.invoice_date;
    if (!d || !String(d).startsWith(String(year))) continue;
    const m = Number(String(d).slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    months[m].gross += inv.total_gross || 0; months[m].credit += inv.total_credit || 0; months[m].count += 1;
  }

  const { data: sales } = await sb().from("sales").select("entry_date,net_amount,vat_amount").eq("client_id", clientId);
  for (const s of sales ?? []) {
    const d = s.entry_date;
    if (!d || !String(d).startsWith(String(year))) continue;
    const m = Number(String(d).slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    months[m].sales += (s.net_amount || 0) + (s.vat_amount || 0);
    months[m].salesVat += s.vat_amount || 0;
  }

  return months.map((x) => ({
    ...x,
    gross: Number(x.gross.toFixed(2)),
    credit: Number(x.credit.toFixed(2)),
    sales: Number(x.sales.toFixed(2)),
    salesVat: Number(x.salesVat.toFixed(2)),
  }));
}

// ---------------- VAT by rate (entradas/saídas por alíquota) ----------------
const r2 = (n: number) => Number(n.toFixed(2));

export interface RateDoc { id: string; label: string; date: string | null; net: number; vat: number; }
export interface RateGroup { rate: number; net: number; vat: number; credit?: number; count: number; docs: RateDoc[]; }

export async function vatByRate(clientId: string, start: string, end: string): Promise<{ purchases: RateGroup[]; sales: RateGroup[] }> {
  // ---- Purchases (entradas): group invoice_items by expected rate ----
  const { data: invs } = await sb().from("invoices")
    .select("id,supplier_name,invoice_number,invoice_date,posting_date,total_net,total_vat,total_gross").eq("client_id", clientId);
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
  // Grouped per invoice (not computed line-by-line) so each line's VAT is
  // resolved on the SAME basis (net vs VAT-inclusive gross) as the invoice
  // edit screen and the credit calc — see lib/vat.ts. Doing this per line in
  // isolation, as before, silently treated every VAT-inclusive receipt price
  // as if it were already net and taxed it again on top, overstating T2.
  const itemsByInvoice = new Map<string, any[]>();
  for (const it of items) itemsByInvoice.set(it.invoice_id, [...(itemsByInvoice.get(it.invoice_id) || []), it]);
  for (const [invId, its] of itemsByInvoice) {
    const inv: any = invMap.get(invId);
    const totals = { total_net: inv?.total_net ?? null, total_vat: inv?.total_vat ?? null, total_gross: inv?.total_gross ?? null };
    const { lines } = computeLines(its, totals);
    its.forEach((it, i) => {
      const rate = Number(it.expected_vat_rate ?? it.vat_rate_on_invoice ?? 0);
      const net = lines[i].net;
      const vat = lines[i].vat;
      const g = pMap.get(rate) || { rate, net: 0, vat: 0, credit: 0, docs: new Map() };
      g.net += net; g.vat += vat; g.credit += Number(it.credit_value || 0);
      const d = g.docs.get(invId) || { net: 0, vat: 0 }; d.net += net; d.vat += vat; g.docs.set(invId, d);
      pMap.set(rate, g);
    });
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

export interface InvoiceRateRow {
  id: string;
  date: string | null;
  supplier: string | null;
  doc_number: string | null;
  gross: number;
  vat: number;
  /** Net for each VAT rate present on this invoice, keyed by rate as a string (e.g. "23"). */
  netByRate: Record<string, number>;
  /** Whether sum(netByRate) + vat reconciles with gross — same check as the Purchases screen. */
  reconciled: boolean;
}

/**
 * Per-invoice Gross/VAT/Net-by-rate breakdown for a client's purchases in a
 * period — the same figures the Purchases screen shows per expanded row
 * (lib/vat.ts computeLines, basis-aware), one row per invoice instead of one
 * expandable panel, for the dedicated export sheet.
 */
export async function invoiceRateBreakdowns(clientId: string, start: string, end: string): Promise<InvoiceRateRow[]> {
  const { data: invs } = await sb().from("invoices")
    .select("id,supplier_name,invoice_number,invoice_date,posting_date,total_net,total_vat,total_gross").eq("client_id", clientId);
  const inPeriod = (invs ?? []).filter((i: any) => { const d = i.posting_date || i.invoice_date; return d && d >= start && d <= end; });
  const invMap = new Map(inPeriod.map((i: any) => [i.id, i]));
  const ids = inPeriod.map((i: any) => i.id);
  let items: any[] = [];
  if (ids.length) {
    const { data } = await sb().from("invoice_items")
      .select("invoice_id,net_amount,vat_amount_on_invoice,expected_vat_rate,vat_rate_on_invoice").in("invoice_id", ids);
    items = data ?? [];
  }

  const itemsByInvoice = new Map<string, any[]>();
  for (const it of items) itemsByInvoice.set(it.invoice_id, [...(itemsByInvoice.get(it.invoice_id) || []), it]);

  const rows: InvoiceRateRow[] = [];
  for (const inv of inPeriod as any[]) {
    const its = itemsByInvoice.get(inv.id) || [];
    const totals = { total_net: inv.total_net ?? null, total_vat: inv.total_vat ?? null, total_gross: inv.total_gross ?? null };
    const { lines } = computeLines(its, totals);
    const netByRate: Record<string, number> = {};
    its.forEach((it, i) => {
      const rate = String(Number(it.expected_vat_rate ?? it.vat_rate_on_invoice ?? 0));
      netByRate[rate] = r2((netByRate[rate] || 0) + lines[i].net);
    });
    const netSum = Object.values(netByRate).reduce((a, v) => a + v, 0);
    const gross = Number(inv.total_gross || 0);
    const vat = Number(inv.total_vat || 0);
    rows.push({
      id: inv.id, date: inv.posting_date || inv.invoice_date || null, supplier: inv.supplier_name || null,
      doc_number: inv.invoice_number || null, gross: r2(gross), vat: r2(vat), netByRate,
      reconciled: Math.abs(netSum + vat - gross) <= Math.max(0.05, Math.abs(gross) * 0.02),
    });
  }
  return rows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

/** Datasets an export can include. */
export type ExportSet = "invoices" | "items" | "sales" | "obligations" | "rates" | "accounts";
export const ALL_EXPORT_SETS: ExportSet[] = ["invoices", "items", "sales", "obligations", "rates", "accounts"];

export interface ExportOptions {
  /** Inclusive yyyy-mm-dd. Defaults to the whole year. */
  start?: string;
  end?: string;
  sets?: ExportSet[];
}

// Export payload for a client over an arbitrary period, limited to the
// datasets asked for so a "just the invoices for March" export stays cheap.
export async function exportData(clientId: string, year: number, opts: ExportOptions = {}) {
  const client = await getClient(clientId);
  const start = opts.start || `${year}-01-01`;
  const end = opts.end || `${year}-12-31`;
  const sets = new Set<ExportSet>(opts.sets?.length ? opts.sets : ALL_EXPORT_SETS);

  const wantsInvoices = sets.has("invoices") || sets.has("items");
  const invoices = wantsInvoices ? await listInvoices({ clientId, start, end }) : [];

  let items: StoredItem[] = [];
  if (sets.has("items") && invoices.length) {
    const { data } = await sb().from("invoice_items").select("*").in("invoice_id", invoices.map((i) => i.id));
    items = (data ?? []) as StoredItem[];
    // Correct net/VAT per line for VAT-inclusive receipts before export —
    // the raw stored net_amount is the printed line price, which for most
    // supermarket/retail receipts IS the gross (VAT-inclusive) price, not
    // net. Exporting it unmodified as "Net" makes Net+VAT stop reconciling
    // to Gross for whoever reads the file. See lib/vat.ts.
    const invById = new Map(invoices.map((i) => [i.id, i]));
    const byInvoice = new Map<string, StoredItem[]>();
    for (const it of items) byInvoice.set(it.invoice_id, [...(byInvoice.get(it.invoice_id) || []), it]);
    for (const [invId, its] of byInvoice) {
      const inv = invById.get(invId);
      const totals = { total_net: inv?.total_net ?? null, total_vat: inv?.total_vat ?? null, total_gross: inv?.total_gross ?? null };
      const { lines } = computeLines(its, totals);
      its.forEach((it, i) => {
        (it as any).net_amount = lines[i].net;
        (it as any).vat_amount_on_invoice = lines[i].vat;
      });
    }
  }

  let sales: SalesEntry[] = [];
  if (sets.has("sales")) {
    const { data } = await sb().from("sales").select("*").eq("client_id", clientId)
      .gte("entry_date", start).lte("entry_date", end).order("entry_date");
    sales = (data ?? []) as SalesEntry[];
  }

  let accounts: ChartAccount[] = [];
  if (sets.has("accounts")) accounts = await listAccounts(clientId);

  const obligations = sets.has("obligations") ? await getObligations(clientId, year) : [];
  const rates = sets.has("rates") ? await vatByRate(clientId, start, end) : { purchases: [], sales: [] };
  const invoiceRates = sets.has("rates") ? await invoiceRateBreakdowns(clientId, start, end) : [];
  const series = await monthlySeries(clientId, year);

  return {
    client, year, start, end, sets: Array.from(sets),
    invoices: sets.has("invoices") ? invoices : [],
    items, sales, accounts, obligations, rates, invoiceRates, series,
  };
}

// ---------------- Client dashboard ----------------
// One aggregate call for the client dashboard, so the screen fills itself as
// soon as sales (T1) and purchase invoices (T2) are posted — no manual entry.
export interface DashboardKpis {
  salesGross: number;   // T1 base: sales invoiced (net + VAT)
  salesVat: number;     // T1: VAT charged on sales
  purchaseGross: number;// T2 base: purchases (gross)
  inputCredit: number;  // T2: recoverable VAT actually taken
  vatPayable: number;   // T3 = T1 - T2
  invoiceCount: number;
  salesCount: number;
}

export async function clientDashboard(clientId: string, year: number) {
  const client = await getClient(clientId);
  const start = `${year}-01-01`, end = `${year}-12-31`;

  const [series, rates, obligations] = await Promise.all([
    monthlySeries(clientId, year),
    vatByRate(clientId, start, end),
    getObligations(clientId, year),
  ]);

  const { count: salesCount } = await sb()
    .from("sales").select("*", { count: "exact", head: true })
    .eq("client_id", clientId).gte("entry_date", start).lte("entry_date", end);

  /*
   * Por onde as notas do ano entraram.
   *
   * É o indicador que responde "a entrada automática está valendo a pena?" —
   * a pergunta que o escritório faz depois de dar o link de telefone ao
   * cliente e o endereço de e-mail ao fornecedor. Sem isto, a resposta era
   * abrir a fila e contar no olho, o que ninguém faz.
   *
   * Conta por `posting_date` (a data em que a nota entra na apuração), o mesmo
   * recorte de ano do resto do painel — senão o total daqui não fecharia com o
   * de cima.
   */
  const { data: sourceRows } = await sb()
    .from("invoices").select("source")
    .eq("client_id", clientId).gte("posting_date", start).lte("posting_date", end);
  const bySource: Record<string, number> = {};
  for (const r of (sourceRows ?? []) as { source: string | null }[]) {
    const k = r.source || "unknown";
    bySource[k] = (bySource[k] || 0) + 1;
  }

  const sum = (k: "gross" | "credit" | "sales" | "salesVat" | "count") =>
    series.reduce((a, s) => a + (s[k] || 0), 0);

  const salesVat = r2(sum("salesVat"));
  const inputCredit = r2(sum("credit"));

  const kpis: DashboardKpis = {
    salesGross: r2(sum("sales")),
    salesVat,
    purchaseGross: r2(sum("gross")),
    inputCredit,
    vatPayable: r2(salesVat - inputCredit),
    invoiceCount: sum("count"),
    salesCount: salesCount ?? 0,
  };

  // Monthly VAT position, for the "VAT por período" chart.
  const vatByMonth = series.map((s) => ({
    month: s.month,
    payable: r2((s.salesVat || 0) - (s.credit || 0)),
  }));

  // Next obligations first: still open, soonest due at the top.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = obligations
    .filter((o) => o.status === "open")
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 5)
    .map((o) => ({
      id: o.id, kind: o.kind, period_label: o.period_label, due_date: o.due_date,
      state: o.due_date < today ? "overdue" : withinDays(o.due_date, today, 60) ? "soon" : "pending",
    }));

  return { client, year, kpis, series, vatByMonth, rates, upcoming, bySource };
}

function withinDays(due: string, from: string, days: number) {
  const diff = (new Date(due).getTime() - new Date(from).getTime()) / 86400000;
  return diff >= 0 && diff <= days;
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
/** Apaga uma venda — mesma trava da nota de compra. */
export async function deleteSalesEntry(id: string): Promise<{ ok: boolean; erro?: string }> {
  const { data: s } = await sb().from("sales")
    .select("document_path,client_id").eq("id", id).maybeSingle();
  if (s?.client_id) {
    const impedimento = await impedimentoParaApagar(String(s.client_id), id, "sale");
    if (impedimento) return { ok: false, erro: impedimento };
  }
  if (s?.document_path) { try { await sb().storage.from(BUCKET).remove([s.document_path]); } catch {} }
  const { error } = await sb().from("sales").delete().eq("id", id);
  return error ? { ok: false, erro: error.message } : { ok: true };
}

/** As linhas de uma venda, para a tela de revisão e a apuração por alíquota. */
export async function listSaleItems(saleId: string) {
  const { data } = await sb().from("sales_items").select("*").eq("sale_id", saleId).order("created_at");
  return data ?? [];
}

export interface SaleDocPayload {
  entry_date: string;
  doc_number: string | null;
  customer: string | null;
  net_amount: number | null;
  vat_rate: number | null;
  vat_amount: number;
  source?: string | null;
  original_filename?: string | null;
  needs_review?: boolean;
  confidence?: number | null;
  /** Quando a venda CHEGOU (a foto foi mandada), não quando foi gravada. */
  captured_at?: string | null;
  doc_kind?: string | null;
  items: Array<{
    description: string; quantity: number | null; unit_price: number | null;
    net_amount: number | null; vat_rate: number | null; vat_amount: number | null;
  }>;
}

/**
 * Uma venda LIDA DE DOCUMENTO: guarda o arquivo, o cabeçalho e as linhas.
 *
 * Separada de `addSalesEntries` (que é digitação e planilha) porque só este
 * caminho tem documento para guardar — e é justamente o documento que faltava
 * na venda que entra por foto.
 *
 * Sem linha legível no documento, grava UMA linha genérica com o valor e a
 * alíquota do cabeçalho: sem ela a venda sumiria da apuração por taxa, e o
 * total por alíquota fecharia menor que o total do período.
 */
export async function saveSaleFromDocument(
  clientId: string, payload: SaleDocPayload, fileBuffer: Buffer | null, ext: string
): Promise<SalesEntry | null> {
  if (!payload.entry_date) return null;
  const id = randomUUID();

  let documentPath: string | null = null;
  if (fileBuffer) {
    const safeExt = (ext || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
    const path = `sales/${id}.${safeExt}`;
    const ct = safeExt === "pdf" ? "application/pdf" : `image/${safeExt === "jpg" ? "jpeg" : safeExt}`;
    const { error } = await sb().storage.from(BUCKET).upload(path, fileBuffer, { contentType: ct, upsert: true });
    if (!error) documentPath = path;
  }

  const row = {
    id, client_id: clientId,
    entry_date: payload.entry_date,
    doc_number: payload.doc_number, customer: payload.customer,
    net_amount: payload.net_amount, vat_rate: payload.vat_rate,
    vat_amount: Number((payload.vat_amount || 0).toFixed(2)),
    document_path: documentPath,
    original_filename: payload.original_filename ?? null,
    source: payload.source ?? null,
    needs_review: payload.needs_review ?? false,
    extraction_confidence: payload.confidence ?? null,
    captured_at: payload.captured_at ?? new Date().toISOString(),
    doc_kind: payload.doc_kind ?? null,
  };
  const { data, error } = await sb().from("sales").insert(row).select().single();
  if (error) throw error;

  const lines = payload.items.length
    ? payload.items
    : [{
        // A linha genérica do documento sem itens (planilha fotografada,
        // recibo só com o total). Ver 014_sales_document.sql.
        description: payload.doc_number ? `Venda ${payload.doc_number}` : "Venda",
        quantity: null, unit_price: null,
        net_amount: payload.net_amount, vat_rate: payload.vat_rate,
        vat_amount: payload.vat_amount,
      }];

  await sb().from("sales_items").insert(lines.map((l) => ({
    sale_id: id, description: l.description || "Venda",
    quantity: l.quantity, unit_price: l.unit_price, net_amount: l.net_amount,
    vat_rate: l.vat_rate, vat_amount: Number((l.vat_amount || 0).toFixed(2)),
  })));

  return data as SalesEntry;
}

// ---------------- Branches / lojas (per client) ----------------
export async function listBranches(clientId: string): Promise<Branch[]> {
  const { data } = await sb().from("branches").select("*").eq("client_id", clientId).order("name");
  return (data ?? []) as Branch[];
}
export async function createBranch(clientId: string, input: Partial<Branch>): Promise<Branch | null> {
  const row = {
    client_id: clientId,
    code: input.code?.trim() || null,
    name: (input.name || "").trim(),
    address: input.address?.trim() || null,
    notes: input.notes?.trim() || null,
  };
  if (!row.name) return null;
  const { data, error } = await sb().from("branches").insert(row).select().single();
  if (error) throw error;
  return data as Branch;
}
export async function updateBranch(id: string, patch: Partial<Branch>): Promise<Branch | null> {
  const row: any = {};
  for (const k of ["code", "name", "address", "notes"]) if (k in patch) row[k] = (patch as any)[k];
  const { data } = await sb().from("branches").update(row).eq("id", id).select().maybeSingle();
  return (data as Branch) ?? null;
}
export async function deleteBranch(id: string): Promise<boolean> {
  const { error } = await sb().from("branches").delete().eq("id", id);
  return !error;
}

// ---------------- Chart of accounts (per client) ----------------
/**
 * A FAIXA reservada às contas próprias de um cliente.
 *
 * Fora dela, a conta é do escritório e vive no plano partilhado — ver a
 * migração 033. 9900–9999 fica para contas de sistema (arredondamento), por
 * isso a faixa do cliente acaba em 9899.
 */
export const FAIXA_CLIENTE = { de: "9000", ate: "9899" };
export const dentroDaFaixaDoCliente = (code: string): boolean =>
  code >= FAIXA_CLIENTE.de && code <= FAIXA_CLIENTE.ate;

export async function listAccounts(clientId: string): Promise<ChartAccount[]> {
  const { data } = await sb().from("chart_of_accounts").select("*").eq("client_id", clientId).order("code");
  return (data ?? []) as ChartAccount[];
}

/** O plano do ESCRITÓRIO — o que a contabilidade usa de facto. */
export async function listSharedAccounts(): Promise<ChartAccount[]> {
  const { data } = await sb().from("chart_of_accounts").select("*").is("client_id", null).order("code");
  return (data ?? []) as ChartAccount[];
}

/**
 * Cria (ou atualiza) uma conta.
 *
 * `clientId` nulo grava no plano do escritório. Com cliente, o código tem de
 * estar na faixa reservada: o banco também o impõe, mas uma mensagem em
 * português vale mais do que um erro de constraint na cara de quem lança.
 */
export async function createAccount(
  clientId: string | null, input: Partial<ChartAccount>
): Promise<ChartAccount | null> {
  const code = (input.code || "").trim();
  if (!code) return null;
  if (clientId && !dentroDaFaixaDoCliente(code)) {
    throw new Error(
      `Conta própria de cliente tem de estar entre ${FAIXA_CLIENTE.de} e ${FAIXA_CLIENTE.ate}. ` +
      `Fora dessa faixa a conta é do escritório — crie-a no plano geral.`
    );
  }
  const row = {
    client_id: clientId,
    code,
    description: (input.description || "").trim(),
    parent_code: input.parent_code?.trim() || null,
    type: (input as any).type || null,
    report_group: (input as any).report_group || null,
    postable: (input as any).postable !== false,
    active: input.active !== false,
  };
  /*
   * Inserir-ou-atualizar à mão, e não `upsert`.
   *
   * Os índices únicos da migração 033 são PARCIAIS (`where client_id is null`
   * e `where client_id is not null`), porque em Postgres dois NULOS não são
   * iguais e um índice em `(client_id, code)` deixaria o plano do escritório
   * aceitar o mesmo código duas vezes. O `onConflict` do PostgREST não sabe
   * mirar num índice parcial: devolve "there is no unique or exclusion
   * constraint matching the ON CONFLICT specification".
   *
   * Procurar primeiro e decidir depois faz o mesmo trabalho e diz a verdade.
   */
  const busca = sb().from("chart_of_accounts").select("id").eq("code", code);
  const { data: existente } = await (clientId
    ? busca.eq("client_id", clientId)
    : busca.is("client_id", null)).maybeSingle();

  if (existente) {
    const { data, error } = await sb().from("chart_of_accounts")
      .update(row).eq("id", (existente as any).id).select().single();
    if (error) throw error;
    return data as ChartAccount;
  }

  const { data, error } = await sb().from("chart_of_accounts").insert(row).select().single();
  if (error) throw error;
  return data as ChartAccount;
}
export async function updateAccount(
  id: string, patch: Partial<ChartAccount>, clientId?: string | null
): Promise<ChartAccount | null> {
  const row: any = {};
  for (const k of ["code", "description", "parent_code", "active"]) if (k in patch) row[k] = (patch as any)[k];
  let q = sb().from("chart_of_accounts").update(row).eq("id", id);
  // Passando `clientId`, a conta tem de ser DELE. Sem isto, o id de uma conta
  // do plano partilhado — que a rota do cliente devolve em `ledgerAccounts` —
  // alterava a conta de TODOS os clientes da base.
  if (clientId) q = q.eq("client_id", clientId);
  const { data } = await q.select().maybeSingle();
  return (data as ChartAccount) ?? null;
}

/**
 * Apaga uma conta do plano — se ela não tiver movimento.
 *
 * O gatilho `journal_conferir` exige que a conta exista no plano, mas só
 * dispara em `journal_lines`: apagar a conta por baixo de lançamentos que já
 * a usam passa sem queixa. E o `trial_balance` faz `left join`, então a linha
 * fica com `type` nulo e é **descartada** do balancete, do DRE e do balanço
 * (ver `lib/accounting/query.ts`). O lançamento continua lá, balanceado, e
 * metade dele deixa de ser contada: o balanço passa a não fechar por esse
 * valor, e o rodapé mostra uma diferença sem causa apontável.
 */
export async function deleteAccount(
  id: string, clientId?: string | null
): Promise<{ ok: boolean; erro?: string }> {
  let q = sb().from("chart_of_accounts").select("id,code,client_id").eq("id", id);
  if (clientId) q = q.eq("client_id", clientId);
  const { data: conta } = await q.maybeSingle();
  if (!conta) return { ok: false, erro: "Conta não encontrada neste cliente." };

  const { count } = await sb().from("journal_lines")
    .select("id", { count: "exact", head: true }).eq("account_code", (conta as any).code);
  if (count && count > 0) {
    return {
      ok: false,
      erro: `A conta ${(conta as any).code} tem ${count} partida(s) no razão. `
        + "Desative-a em vez de a apagar — apagar deixaria esses lançamentos fora do balancete, "
        + "e o balanço passaria a não fechar por esse valor.",
    };
  }

  const { error } = await sb().from("chart_of_accounts").delete().eq("id", id);
  return error ? { ok: false, erro: error.message } : { ok: true };
}

// ---------------- Recurring obligations (manual, per client) ----------------
export async function listRecurringObligations(clientId: string): Promise<RecurringObligation[]> {
  const { data } = await sb().from("recurring_obligations").select("*")
    .eq("client_id", clientId).order("due_date", { ascending: true, nullsFirst: false });
  return (data ?? []) as RecurringObligation[];
}
export async function createRecurringObligation(
  clientId: string, input: Partial<RecurringObligation>
): Promise<RecurringObligation | null> {
  const name = (input.name || "").trim();
  if (!name) return null;
  const row = {
    client_id: clientId,
    name,
    category: input.category?.trim() || null,
    periodicity: input.periodicity?.trim() || null,
    due_date: input.due_date || null,
    status: input.status?.trim() || "open",
    notes: input.notes?.trim() || null,
  };
  const { data, error } = await sb().from("recurring_obligations").insert(row).select().single();
  if (error) throw error;
  return data as RecurringObligation;
}
export async function updateRecurringObligation(
  id: string, patch: Partial<RecurringObligation>
): Promise<RecurringObligation | null> {
  const row: any = { updated_at: new Date().toISOString() };
  for (const k of ["name", "category", "periodicity", "due_date", "status", "notes"]) {
    if (k in patch) row[k] = (patch as any)[k];
  }
  const { data } = await sb().from("recurring_obligations").update(row).eq("id", id).select().maybeSingle();
  return (data as RecurringObligation) ?? null;
}
export async function deleteRecurringObligation(id: string): Promise<boolean> {
  const { error } = await sb().from("recurring_obligations").delete().eq("id", id);
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
// ---------------- App users ----------------
export async function listAppUsers(companyId?: string | null): Promise<AppUser[]> {
  let query = sb().from("app_users").select("*").order("created_at");
  if (companyId) query = query.eq("company_id", companyId);
  const { data } = await query;
  return (data ?? []) as AppUser[];
}

export async function createAppUser(input: {
  email: string; name: string | null; password_hash: string; role: string;
  company_id?: string | null; screen_access?: string[] | null;
}): Promise<AppUser> {
  const { data, error } = await sb().from("app_users").insert({
    email: input.email.toLowerCase().trim(),
    name: input.name?.trim() || null,
    password_hash: input.password_hash,
    role: input.role,
    company_id: input.company_id ?? null,
    screen_access: input.screen_access ?? null,
    active: true,
    must_change: false,
  }).select().single();
  if (error) throw error;
  return data as AppUser;
}

export async function updateAppUser(
  id: string,
  patch: Partial<Pick<AppUser, "name" | "role" | "active" | "screen_access">> & { password_hash?: string }
): Promise<AppUser | null> {
  const row: any = {};
  for (const k of ["name", "role", "active", "password_hash", "screen_access"]) {
    if (k in patch) row[k] = (patch as any)[k];
  }
  if (!Object.keys(row).length) return null;
  const { data } = await sb().from("app_users").update(row).eq("id", id).select().maybeSingle();
  return (data as AppUser) ?? null;
}

export async function deleteAppUser(id: string): Promise<boolean> {
  const { error } = await sb().from("app_users").delete().eq("id", id);
  return !error;
}

export async function findAppUserByEmail(email: string): Promise<AppUser | null> {
  const { data } = await sb().from("app_users").select("*").eq("email", email.toLowerCase().trim()).eq("active", true).maybeSingle();
  return (data as AppUser) ?? null;
}

// ---------------- Stats ----------------
/**
 * Os números do painel.
 *
 * `year` é o exercício fiscal escolhido na barra do topo. Quando vem, corta
 * notas e vendas pela data do documento — e é isso que faz o seletor do topo
 * significar alguma coisa no painel primário, que até aqui somava o histórico
 * inteiro e não reagia a ele.
 *
 * Sem `year` continua a somar tudo: a contagem de clientes, itens e catálogo
 * não tem data e não deve encolher por causa do ano escolhido.
 */
export async function stats(
  clientId?: string, allowedClientIds?: string[] | null, year?: number
) {
  let iq = sb().from("invoices").select("id,total_gross,total_credit,needs_review");
  if (clientId) iq = iq.eq("client_id", clientId);
  else if (allowedClientIds) iq = iq.in("client_id", allowedClientIds.length ? allowedClientIds : ["00000000-0000-0000-0000-000000000000"]);
  let sq = sb().from("sales").select("net_amount,vat_amount");
  if (clientId) sq = sq.eq("client_id", clientId);
  else if (allowedClientIds) sq = sq.in("client_id", allowedClientIds.length ? allowedClientIds : ["00000000-0000-0000-0000-000000000000"]);

  if (year) {
    const de = `${year}-01-01`;
    const ate = `${year}-12-31`;
    iq = iq.gte("invoice_date", de).lte("invoice_date", ate);
    sq = sq.gte("entry_date", de).lte("entry_date", ate);
  }

  const [{ data: invs }, { data: sales }, { count: clientsCount }, { count: itemsCount }, { count: masterCount }] =
    await Promise.all([
      iq,
      sq,
      sb().from("clients").select("*", { count: "exact", head: true }),
      sb().from("invoice_items").select("*", { count: "exact", head: true }),
      sb().from("items_master").select("*", { count: "exact", head: true }),
    ]);

  const list = invs ?? [];
  const salesList = sales ?? [];
  const salesVat = salesList.reduce((a: number, s: any) => a + (s.vat_amount || 0), 0);
  const credit = list.reduce((a: number, i: any) => a + (i.total_credit || 0), 0);

  return {
    invoices: list.length,
    items: itemsCount ?? 0,
    unique_items: masterCount ?? 0,
    clients: clientsCount ?? 0,
    needs_review: list.filter((i: any) => i.needs_review).length,
    total_credit: r2(credit),
    total_gross: r2(list.reduce((a: number, i: any) => a + (i.total_gross || 0), 0)),
    // Consolidated VAT position across everything in scope: what was charged on
    // sales (T1) minus the input credit taken on purchases (T2).
    sales_gross: r2(salesList.reduce((a: number, s: any) => a + (s.net_amount || 0) + (s.vat_amount || 0), 0)),
    sales_vat: r2(salesVat),
    vat_payable: r2(salesVat - credit),
  };
}

// ---------------- Companies (tenants) ----------------
/** Uma empresa pelo id. Usada pelo admin para ver a própria licença. */
export async function getCompany(id: string): Promise<Company | null> {
  const { data } = await sb().from("companies").select("*").eq("id", id).maybeSingle();
  return (data as Company) ?? null;
}

export async function listCompanies(): Promise<Company[]> {
  const { data } = await sb().from("companies").select("*").order("name");
  return (data ?? []) as Company[];
}

export async function companyStats(): Promise<Record<string, { clients: number; users: number }>> {
  const [{ data: cl }, { data: us }] = await Promise.all([
    sb().from("clients").select("company_id"),
    sb().from("app_users").select("company_id"),
  ]);
  const out: Record<string, { clients: number; users: number }> = {};
  const bump = (id: string | null, k: "clients" | "users") => {
    if (!id) return;
    out[id] = out[id] || { clients: 0, users: 0 };
    out[id][k]++;
  };
  for (const c of cl ?? []) bump((c as any).company_id, "clients");
  for (const u of us ?? []) bump((u as any).company_id, "users");
  return out;
}

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "company";

/**
 * Activation key. Random, stored as-is — this is a licence marker the operator
 * hands over, not a secret that authenticates anything on its own.
 */
export function generateLicenseKey(): string {
  const block = () => randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase();
  return `VAT-${block()}-${block()}-${block()}`;
}

export async function createCompany(input: {
  name: string; slug?: string; contact_email?: string | null; months?: number;
}): Promise<Company> {
  const expires = new Date();
  expires.setMonth(expires.getMonth() + (input.months ?? 12));
  const { data, error } = await sb().from("companies").insert({
    name: input.name.trim(),
    slug: (input.slug?.trim() || slugify(input.name)),
    active: true,
    license_key: generateLicenseKey(),
    license_expires_at: expires.toISOString().slice(0, 10),
    contact_email: input.contact_email?.trim() || null,
  }).select().single();
  if (error) throw error;
  await logLicenseEvent(data.id, "created", null, data.license_expires_at);
  return data as Company;
}

async function logLicenseEvent(
  companyId: string,
  eventType: string,
  oldExpiresAt: string | null,
  newExpiresAt: string | null,
  actorEmail?: string | null
) {
  await sb().from("license_events").insert({
    company_id: companyId, event_type: eventType,
    old_expires_at: oldExpiresAt, new_expires_at: newExpiresAt,
    actor_email: actorEmail ?? null,
  });
}

export async function updateCompany(
  id: string,
  patch: Partial<Pick<Company, "name" | "active" | "license_expires_at" | "license_key" | "contact_email" | "notes">>,
  opts?: { actorEmail?: string | null; eventType?: string }
): Promise<Company | null> {
  const row: any = {};
  for (const k of ["name", "active", "license_expires_at", "license_key", "contact_email", "notes"]) {
    if (k in patch) row[k] = (patch as any)[k];
  }
  if (!Object.keys(row).length) return null;

  let before: { license_expires_at: string | null } | null = null;
  if (opts?.eventType) {
    const { data } = await sb().from("companies").select("license_expires_at").eq("id", id).maybeSingle();
    before = (data as any) ?? null;
  }

  const { data } = await sb().from("companies").update(row).eq("id", id).select().maybeSingle();
  if (data && opts?.eventType) {
    await logLicenseEvent(id, opts.eventType, before?.license_expires_at ?? null, (data as Company).license_expires_at, opts.actorEmail);
  }
  return (data as Company) ?? null;
}

/**
 * Master generates a renewal without touching the live licence — a new key
 * and a new expiry (extending from whichever is later: today or the current
 * expiry, so renewing early doesn't lose the remaining term) sit in
 * `pending_*` until the client's own admin activates it (see
 * activateLicense). Returns the key to hand to the client.
 */
export async function generatePendingRenewal(
  companyId: string, actorEmail?: string | null, months = 12
): Promise<{ key: string; expiresAt: string }> {
  const { data: company } = await sb().from("companies").select("license_expires_at").eq("id", companyId).maybeSingle();
  const current = company?.license_expires_at ? new Date(company.license_expires_at) : new Date();
  const today = new Date();
  const base = current > today ? current : today;
  base.setMonth(base.getMonth() + months);
  const expiresAt = base.toISOString().slice(0, 10);
  const key = generateLicenseKey();
  await sb().from("companies").update({ pending_license_key: key, pending_license_expires_at: expiresAt }).eq("id", companyId);
  await logLicenseEvent(companyId, "renewal_generated", company?.license_expires_at ?? null, expiresAt, actorEmail);
  return { key, expiresAt };
}

/**
 * Company admin self-service activation: promotes a pending renewal to the
 * live licence when the key they were given matches. Never lets the admin
 * set an arbitrary expiry themselves — only what master already generated.
 */
/**
 * Ativa a licença a partir da chave que o admin colou.
 *
 * Dois caminhos, e a ordem importa:
 *
 *   1. **Chave ASSINADA** (`VATERP1.…`). Ela carrega para quem é e até quando
 *      vale, e a assinatura é conferida com a chave pública embutida. **Não exige
 *      nada gravado antes no banco** — que é o ponto: quem vende a licença não
 *      precisa, e não deve, ter acesso à instalação do cliente.
 *   2. **Chave pendente** (o formato antigo, `VAT-XXXXX-…`). Continua funcionando
 *      para renovação lançada pelo painel `master` numa instalação a que ele tem
 *      acesso. Fica como segundo caminho, não como único.
 */
export async function activateLicense(
  companyId: string, key: string, actorEmail?: string | null
): Promise<{ ok: true; expiresAt: string } | { ok: false; error: string }> {
  const { data: company } = await sb()
    .from("companies")
    .select("slug,license_key,license_expires_at,pending_license_key,pending_license_expires_at")
    .eq("id", companyId).maybeSingle();
  if (!company) return { ok: false, error: "Empresa não encontrada." };

  const typed = key.trim();

  // ---- caminho 1: chave assinada ----
  if (typed.startsWith("VATERP1.")) {
    const verified = verifyLicenseKey(typed);
    if (!verified.ok) return { ok: false, error: verified.error };

    const fits = checkFit(verified.payload, (company as any).slug, (company as any).license_expires_at);
    if (!fits.ok) return { ok: false, error: fits.error };

    const newExpiry = verified.payload.e;
    await sb().from("companies").update({
      license_key: typed,
      license_expires_at: newExpiry,
      // Uma renovação assinada torna sem efeito qualquer pendência do caminho
      // antigo: deixá-la ali faria a próxima ativação aplicar a data velha.
      pending_license_key: null,
      pending_license_expires_at: null,
    }).eq("id", companyId);

    await logLicenseEvent(
      companyId, "activated_by_key",
      (company as any).license_expires_at, newExpiry, actorEmail
    );
    return { ok: true, expiresAt: newExpiry };
  }

  // ---- caminho 2: chave pendente, lançada pelo painel master ----
  if (!company.pending_license_key) {
    return { ok: false, error: "Nenhuma renovação pendente. Se você recebeu uma chave por e-mail, ela começa com VATERP1." };
  }
  if (typed.toUpperCase() !== company.pending_license_key.toUpperCase()) {
    return { ok: false, error: "Essa chave não confere." };
  }
  const newExpiry = company.pending_license_expires_at;
  await sb().from("companies").update({
    license_key: company.pending_license_key, license_expires_at: newExpiry,
    pending_license_key: null, pending_license_expires_at: null,
  }).eq("id", companyId);
  await logLicenseEvent(companyId, "activated_by_admin", company.license_expires_at, newExpiry, actorEmail);
  return { ok: true, expiresAt: newExpiry! };
}

export async function listLicenseEvents(companyId: string) {
  const { data } = await sb()
    .from("license_events").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(20);
  return data ?? [];
}
