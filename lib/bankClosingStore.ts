/**
 * Fechamento do período (camada A5).
 *
 * O relatório em si é calculado por `lib/closingReport.ts`, que é puro. Aqui
 * fica o que precisa de banco: buscar o que existia até a data, guardar o
 * fechamento aceito, e fazer valer o cadeado.
 *
 * O cadeado é a parte que muda o comportamento do resto do sistema: depois de
 * fechado, conciliar, desconciliar ou importar dentro do período fechado passa
 * a ser recusado. Mudar o passado tem que exigir reabrir o período de
 * propósito — nunca acontecer por acidente no meio de outro trabalho.
 */

import { getServerSupabase } from "@/lib/supabase";
import {
  buildClosingReport, findPotentialDuplicates,
  type ClosingLine, type ClosingReport, type ClosingTxn,
} from "@/lib/closingReport";

const sb = () => getServerSupabase();

const money = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
};
const isDate = (v: unknown): v is string => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));

export interface StoredClosing {
  id: string;
  bank_account_id: string;
  client_id: string;
  period_end: string;
  statement_balance: number;
  system_balance: number;
  reported_balance: number | null;
  difference: number | null;
  unreconciled_lines_count: number;
  unreconciled_lines_total: number;
  outstanding_txn_count: number;
  outstanding_txn_total: number;
  note: string | null;
  locked: boolean;
  created_at: string;
}

export interface ClosingView {
  report: ClosingReport;
  duplicates: Array<[ClosingLine, ClosingLine]>;
  /** Fechamento já gravado para exatamente esta data, se houver. */
  existing: StoredClosing | null;
  /** Data do último período fechado nesta conta. */
  lockedThrough: string | null;
}

/** Tudo que existia na conta até `asOf`, transformado em relatório. */
export async function closingReportFor(
  accountId: string, asOf: string, reportedBalance?: number | null
): Promise<ClosingView | null> {
  if (!isDate(asOf)) return null;

  const [{ data: account }, { data: lines }, { data: txns }, { data: closings }] = await Promise.all([
    sb().from("bank_accounts").select("opening_balance").eq("id", accountId).maybeSingle(),
    sb().from("bank_statement_lines").select("id,line_date,amount,description,status")
      .eq("bank_account_id", accountId).lte("line_date", asOf).order("line_date").limit(5000),
    sb().from("bank_transactions").select("id,txn_date,amount,description,statement_line_id")
      .eq("bank_account_id", accountId).lte("txn_date", asOf).order("txn_date").limit(5000),
    sb().from("bank_closings").select("*").eq("bank_account_id", accountId)
      .order("period_end", { ascending: false }).limit(50),
  ]);
  if (!account) return null;

  const closingLines: ClosingLine[] = (lines ?? []).map((l: any) => ({
    id: l.id, line_date: l.line_date, amount: money(l.amount),
    description: l.description, status: l.status,
  }));
  const closingTxns: ClosingTxn[] = (txns ?? []).map((t: any) => ({
    id: t.id, txn_date: t.txn_date, amount: money(t.amount),
    description: t.description, statement_line_id: t.statement_line_id,
  }));

  const stored = (closings ?? []) as StoredClosing[];

  return {
    report: buildClosingReport({
      openingBalance: money((account as any).opening_balance),
      lines: closingLines,
      transactions: closingTxns,
      reportedBalance: reportedBalance ?? null,
    }),
    duplicates: findPotentialDuplicates(closingLines),
    existing: stored.find((c) => c.period_end === asOf) ?? null,
    lockedThrough: stored.find((c) => c.locked)?.period_end ?? null,
  };
}

export async function listClosings(accountId: string): Promise<StoredClosing[]> {
  const { data } = await sb().from("bank_closings").select("*")
    .eq("bank_account_id", accountId).order("period_end", { ascending: false }).limit(60);
  return (data ?? []) as StoredClosing[];
}

/**
 * Guarda o fechamento — inclusive a fotografia do que estava pendente.
 *
 * Sem essa fotografia, o relatório de março lido em julho mostraria as
 * pendências de julho, e deixaria de ser prova de coisa nenhuma.
 */
export async function saveClosing(
  accountId: string, clientId: string, asOf: string,
  input: { reportedBalance?: number | null; note?: string | null; locked?: boolean },
  userId: string | null
): Promise<{ ok: boolean; error?: string; closing?: StoredClosing }> {
  const view = await closingReportFor(accountId, asOf, input.reportedBalance ?? null);
  if (!view) return { ok: false, error: "Conta ou data inválida." };

  const r = view.report;
  if (!r.closable) {
    return {
      ok: false,
      error: r.difference !== null && Math.abs(r.difference) > 0.01
        ? `Não dá para fechar com diferença de ${r.difference.toFixed(2)} contra o saldo informado.`
        : "Não dá para fechar: a diferença entre os saldos não está explicada.",
    };
  }

  const row = {
    bank_account_id: accountId,
    client_id: clientId,
    period_end: asOf,
    statement_balance: r.statementBalance,
    system_balance: r.systemBalance,
    reported_balance: r.reportedBalance,
    difference: r.difference,
    unreconciled_lines_count: r.unreconciled.count,
    unreconciled_lines_total: r.unreconciled.total,
    outstanding_txn_count: r.outstanding.count,
    outstanding_txn_total: r.outstanding.total,
    note: input.note?.trim() || null,
    locked: input.locked !== false,
    created_by: userId,
  };

  const { data, error } = await sb().from("bank_closings")
    .upsert(row, { onConflict: "bank_account_id,period_end" }).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, closing: data as StoredClosing };
}

/** Reabrir um período: some o cadeado, e o registro do fechamento vai junto. */
export async function reopenClosing(id: string): Promise<boolean> {
  const { error } = await sb().from("bank_closings").delete().eq("id", id);
  return !error;
}

/** Data do último período fechado nesta conta, ou null. */
export async function lockedThrough(accountId: string): Promise<string | null> {
  const { data } = await sb().from("bank_closings").select("period_end")
    .eq("bank_account_id", accountId).eq("locked", true)
    .order("period_end", { ascending: false }).limit(1).maybeSingle();
  return (data as any)?.period_end ?? null;
}

/**
 * O cadeado, aplicado a uma data.
 *
 * Devolve a mensagem de recusa, ou null quando pode seguir. Fica aqui, num
 * lugar só, para não existir um caminho que esqueceu de conferir.
 */
export async function periodLockError(accountId: string, date: string): Promise<string | null> {
  const until = await lockedThrough(accountId);
  if (!until || !isDate(date)) return null;
  if (date <= until) {
    return `Período fechado até ${until}. Para mexer nesta linha, reabra o fechamento primeiro.`;
  }
  return null;
}
