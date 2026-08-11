/**
 * Data access for bank accounts and statement lines (camadas A0/A1).
 *
 * Kept out of lib/store.ts because that file is already large and this is a
 * self-contained subject: the money side of the system.
 *
 * The rule that shapes everything here: **a statement line is what the bank
 * said, and is never edited**. It is inserted once and afterwards only gains a
 * reconciliation link. That is what makes the two balances provable at month
 * end — see selfhost/schema/004_bank_reconciliation.sql.
 */

import { getServerSupabase } from "@/lib/supabase";
import { lockedThrough } from "@/lib/bankClosingStore";
import type { ColumnMapping, StatementLine } from "@/lib/bankStatement";
import type {
  BankAccount, BankAccountBalance, BankImport, StoredStatementLine,
} from "@/lib/types";

const sb = () => getServerSupabase();

const money = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
};
const text = (v: unknown, max = 500): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};
const isDate = (v: unknown): v is string => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));

// ---------------- Contas bancárias ----------------

export async function listBankAccounts(clientId: string): Promise<BankAccount[]> {
  const { data } = await sb()
    .from("bank_accounts").select("*").eq("client_id", clientId)
    .order("active", { ascending: false }).order("name");
  return (data ?? []) as BankAccount[];
}

export async function getBankAccount(id: string): Promise<BankAccount | null> {
  const { data } = await sb().from("bank_accounts").select("*").eq("id", id).maybeSingle();
  return (data as BankAccount) ?? null;
}

/**
 * The two balances, per account. They are meant to disagree while something is
 * unreconciled — the gap *is* the work left to do.
 */
export async function listBankBalances(clientId: string): Promise<BankAccountBalance[]> {
  const { data } = await sb()
    .from("bank_account_balances").select("*").eq("client_id", clientId);
  return (data ?? []) as BankAccountBalance[];
}

export async function createBankAccount(
  clientId: string, input: Partial<BankAccount>
): Promise<BankAccount | null> {
  const name = text(input.name, 120);
  if (!name) return null;
  const row = {
    client_id: clientId,
    name,
    bank_name: text(input.bank_name, 120),
    account_ref: text(input.account_ref, 60),
    currency: (text(input.currency, 3) || "EUR").toUpperCase(),
    opening_balance: money(input.opening_balance) ?? 0,
    opening_date: isDate(input.opening_date) ? input.opening_date : null,
  };
  const { data, error } = await sb().from("bank_accounts").insert(row).select().single();
  if (error) throw error;
  return data as BankAccount;
}

export async function updateBankAccount(
  id: string, patch: Partial<BankAccount>
): Promise<BankAccount | null> {
  const row: Record<string, unknown> = {};
  if ("name" in patch) row.name = text(patch.name, 120);
  if ("bank_name" in patch) row.bank_name = text(patch.bank_name, 120);
  if ("account_ref" in patch) row.account_ref = text(patch.account_ref, 60);
  if ("currency" in patch) row.currency = (text(patch.currency, 3) || "EUR").toUpperCase();
  if ("opening_balance" in patch) row.opening_balance = money(patch.opening_balance) ?? 0;
  if ("opening_date" in patch) row.opening_date = isDate(patch.opening_date) ? patch.opening_date : null;
  if ("active" in patch) row.active = patch.active !== false;
  if ("column_mapping" in patch) row.column_mapping = patch.column_mapping ?? null;
  if (!Object.keys(row).length) return getBankAccount(id);
  if (row.name === null) delete row.name; // never blank the name by accident

  const { data } = await sb().from("bank_accounts").update(row).eq("id", id).select().maybeSingle();
  return (data as BankAccount) ?? null;
}

export async function deleteBankAccount(id: string): Promise<boolean> {
  const { error } = await sb().from("bank_accounts").delete().eq("id", id);
  return !error;
}

// ---------------- Linhas do extrato ----------------

export interface LineFilter {
  from?: string | null;
  to?: string | null;
  status?: StoredStatementLine["status"] | null;
  importId?: string | null;
  limit?: number;
}

export async function listStatementLines(
  accountId: string, filter: LineFilter = {}
): Promise<StoredStatementLine[]> {
  let q = sb().from("bank_statement_lines").select("*").eq("bank_account_id", accountId);
  if (isDate(filter.from)) q = q.gte("line_date", filter.from);
  if (isDate(filter.to)) q = q.lte("line_date", filter.to);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.importId) q = q.eq("import_id", filter.importId);
  const { data } = await q
    .order("line_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(filter.limit ?? 500, 1), 2000));
  return (data ?? []) as StoredStatementLine[];
}

/**
 * Which of these keys the account already has.
 *
 * Chunked because a year of statements is thousands of keys and PostgREST puts
 * the whole `in(...)` list in the URL.
 */
export async function existingDedupeKeys(accountId: string, keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < keys.length; i += 400) {
    const chunk = keys.slice(i, i + 400);
    if (!chunk.length) continue;
    const { data } = await sb()
      .from("bank_statement_lines").select("dedupe_key")
      .eq("bank_account_id", accountId).in("dedupe_key", chunk);
    for (const r of data ?? []) found.add((r as { dedupe_key: string }).dedupe_key);
  }
  return found;
}

/** A line as it arrives from the browser, before we trust any of it. */
function toRow(accountId: string, importId: string | null, l: StatementLine) {
  const amount = money(l.amount);
  if (!isDate(l.line_date) || amount === null) return null;
  if (!l.dedupe_key || typeof l.dedupe_key !== "string") return null;
  return {
    bank_account_id: accountId,
    import_id: importId,
    line_date: l.line_date,
    description: text(l.description),
    payee: text(l.payee, 200),
    reference: text(l.reference, 120),
    amount,
    balance: money(l.balance),
    source: "import",
    dedupe_key: l.dedupe_key.slice(0, 80),
  };
}

export interface ImportOutcome {
  importId: string | null;
  imported: number;
  skipped: number;
  rejected: number;
  /** Linhas recusadas por caírem dentro de um período já fechado. */
  locked?: number;
  lockedThrough?: string | null;
}

/**
 * Saves a batch of statement lines.
 *
 * Anti-duplicate is done by the database, not by this function: the unique
 * index on (bank_account_id, dedupe_key) plus `ON CONFLICT DO NOTHING` means a
 * re-imported period cannot double up even if two people import the same file
 * at the same moment. Counting what came back is how we report it.
 */
export async function importStatementLines(
  accountId: string,
  opts: {
    lines: StatementLine[];
    filename?: string | null;
    format?: string | null;
    mapping?: ColumnMapping | null;
    userId?: string | null;
  }
): Promise<ImportOutcome> {
  const candidates = opts.lines.map((l) => toRow(accountId, null, l));
  const all = candidates.filter((r): r is NonNullable<typeof r> => r !== null);
  const rejected = candidates.length - all.length;

  // Linha dentro de período fechado não entra. Importar por cima de um mês
  // fechado mudaria um saldo que já foi dado como conferido, e ninguém veria.
  const until = await lockedThrough(accountId);
  const valid = until ? all.filter((r) => r.line_date > until) : all;
  const locked = all.length - valid.length;

  if (!valid.length) {
    return { importId: null, imported: 0, skipped: 0, rejected, locked, lockedThrough: until };
  }

  const { data: imp, error: impErr } = await sb().from("bank_imports").insert({
    bank_account_id: accountId,
    filename: text(opts.filename, 200),
    format: text(opts.format, 20) || "csv",
    imported_by: opts.userId ?? null,
  }).select("id").single();
  if (impErr) throw impErr;
  const importId = (imp as { id: string }).id;

  const { data: inserted, error } = await sb()
    .from("bank_statement_lines")
    .upsert(valid.map((r) => ({ ...r, import_id: importId })), {
      onConflict: "bank_account_id,dedupe_key",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) {
    await sb().from("bank_imports").delete().eq("id", importId);
    throw error;
  }

  const imported = (inserted ?? []).length;
  const skipped = valid.length - imported;
  await sb().from("bank_imports")
    .update({ line_count: imported, skipped_count: skipped }).eq("id", importId);

  // An import that turned out to be entirely duplicate leaves no trace worth
  // keeping — the accountant re-picked a file they had already loaded.
  if (imported === 0) {
    await sb().from("bank_imports").delete().eq("id", importId);
    return { importId: null, imported: 0, skipped, rejected, locked, lockedThrough: until };
  }

  if (opts.mapping) await updateBankAccount(accountId, { column_mapping: opts.mapping });
  return { importId, imported, skipped, rejected, locked, lockedThrough: until };
}

export async function listBankImports(accountId: string): Promise<BankImport[]> {
  const { data } = await sb()
    .from("bank_imports").select("*").eq("bank_account_id", accountId)
    .order("created_at", { ascending: false }).limit(50);
  return (data ?? []) as BankImport[];
}

/**
 * Undo a whole import.
 *
 * Refused once anything in it has been reconciled: removing a line that a
 * transaction points at would leave the payment hanging with nothing to prove
 * it happened. Unreconcile first, then undo.
 */
export async function deleteBankImport(
  importId: string
): Promise<{ ok: boolean; removed: number; reason?: string }> {
  const { count } = await sb()
    .from("bank_statement_lines").select("id", { count: "exact", head: true })
    .eq("import_id", importId).neq("status", "unreconciled");
  if ((count ?? 0) > 0) {
    return { ok: false, removed: 0, reason: `${count} linha(s) deste lote já foram conciliadas.` };
  }

  const { data: removed, error } = await sb()
    .from("bank_statement_lines").delete().eq("import_id", importId).select("id");
  if (error) throw error;
  await sb().from("bank_imports").delete().eq("id", importId);
  return { ok: true, removed: (removed ?? []).length };
}
