/**
 * Reconciling a statement line against what is already posted (camada A2).
 *
 * The two-series model from camada A0 is what makes this safe: the statement
 * line is never edited. Confirming a match **creates a transaction** on the
 * system side and links it to the line. That is why there are two different
 * ways to take it back, and why they are not the same button:
 *
 *   desconciliar → remove só o vínculo. O pagamento continua lançado na nota,
 *                  e aparece como "pagamento em aberto" no fechamento.
 *   refazer      → apaga a transação. A nota volta a dever.
 *
 * Collapsing the two into one "undo" is the tempting simplification, and it is
 * wrong: the accountant who linked the right payment to the wrong line wants
 * the first, and the one who invented a payment that never existed wants the
 * second.
 */

import { getServerSupabase } from "@/lib/supabase";
import { suggestMatches, bestSuggestion, type MatchCandidate, type MatchSuggestion } from "@/lib/bankMatch";
import type { StoredStatementLine } from "@/lib/types";

const sb = () => getServerSupabase();

const money = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
};

/**
 * Documents that still expect money to move: purchase invoices not fully paid,
 * and sales not fully received.
 *
 * Fully settled documents are left out on purpose — offering them as candidates
 * is how a second payment gets attached to an invoice that was already paid.
 */
export async function openDocuments(clientId: string): Promise<MatchCandidate[]> {
  const out: MatchCandidate[] = [];

  const [{ data: invoices }, { data: status }] = await Promise.all([
    sb().from("invoices")
      .select("id,supplier_name,invoice_number,invoice_date,posting_date,total_gross")
      .eq("client_id", clientId).limit(2000),
    sb().from("invoice_payment_status")
      .select("invoice_id,amount_due,payment_status").eq("client_id", clientId).limit(2000),
  ]);

  const due = new Map<string, number>();
  for (const r of status ?? []) {
    const row = r as { invoice_id: string; amount_due: unknown; payment_status: string };
    if (row.payment_status === "paid" || row.payment_status === "n/a") continue;
    due.set(row.invoice_id, money(row.amount_due));
  }

  for (const r of invoices ?? []) {
    const inv = r as any;
    const outstanding = due.get(inv.id);
    if (outstanding === undefined || outstanding <= 0.01) continue;
    out.push({
      kind: "invoice",
      id: inv.id,
      party: inv.supplier_name ?? null,
      doc_number: inv.invoice_number ?? null,
      doc_date: inv.invoice_date ?? inv.posting_date ?? null,
      total: money(inv.total_gross),
      outstanding,
    });
  }

  // Vendas não têm view de situação: o bruto é net + VAT e o recebido sai das
  // transações já ligadas a ela.
  const [{ data: sales }, { data: received }] = await Promise.all([
    sb().from("sales")
      .select("id,entry_date,doc_number,customer,net_amount,vat_amount")
      .eq("client_id", clientId).limit(2000),
    sb().from("bank_transactions")
      .select("sale_id,amount").eq("client_id", clientId).not("sale_id", "is", null).limit(5000),
  ]);

  const paidBySale = new Map<string, number>();
  for (const r of received ?? []) {
    const t = r as { sale_id: string; amount: unknown };
    paidBySale.set(t.sale_id, (paidBySale.get(t.sale_id) ?? 0) + Math.abs(money(t.amount)));
  }

  for (const r of sales ?? []) {
    const s = r as any;
    const total = money(money(s.net_amount) + money(s.vat_amount));
    const outstanding = Number((total - (paidBySale.get(s.id) ?? 0)).toFixed(2));
    if (outstanding <= 0.01) continue;
    out.push({
      kind: "sale",
      id: s.id,
      party: s.customer ?? null,
      doc_number: s.doc_number ?? null,
      doc_date: s.entry_date ?? null,
      total,
      outstanding,
    });
  }

  return out;
}

export interface PostedPayment {
  id: string;
  txn_date: string;
  description: string | null;
  contact_name: string | null;
  amount: number;
  invoice_id: string | null;
  sale_id: string | null;
  reason: string | null;
}

export interface LineWithSuggestions {
  line: StoredStatementLine;
  best: MatchSuggestion | null;
  others: MatchSuggestion[];
  /**
   * Movimentos já lançados que esta linha pode estar mostrando.
   *
   * Sem isto existe uma armadilha: quem desconcilia uma linha deixa o pagamento
   * lançado e sem vínculo, e a única ação que sobra na tela é "sem documento" —
   * que cria um SEGUNDO movimento e dobra o dinheiro. Aqui a linha volta a se
   * ligar ao que já existe, sem lançar nada novo.
   */
  posted: PostedPayment[];
}

/** Lines still waiting, each with what the system would propose. */
export async function pendingWithSuggestions(
  accountId: string, clientId: string, limit = 200
): Promise<{ lines: LineWithSuggestions[]; candidates: MatchCandidate[] }> {
  const [{ data }, candidates, posted] = await Promise.all([
    sb().from("bank_statement_lines").select("*")
      .eq("bank_account_id", accountId).eq("status", "unreconciled")
      .order("line_date", { ascending: false }).limit(limit),
    openDocuments(clientId),
    outstandingTransactions(accountId),
  ]);

  const lines = ((data ?? []) as StoredStatementLine[]).map((line) => {
    const amount = money(line.amount);
    const all = suggestMatches(
      { line_date: line.line_date, amount, description: line.description, reference: line.reference, payee: line.payee },
      candidates
    );
    const best = bestSuggestion(all);
    // Só as que valem olhar: uma lista de 40 "possíveis" com 3 pontos cada não
    // ajuda ninguém a decidir.
    const others = all.filter((s) => s !== best && s.score >= 20).slice(0, 5);
    // Aqui o critério é estreito de propósito — mesmo sinal, mesmo valor ao
    // cêntimo, e perto no tempo. Ligar a linha ao movimento errado não cria
    // dinheiro, mas deixa dois documentos com a história trocada.
    const near = posted.filter((t) => {
      const a = money(t.amount);
      if (Math.abs(a - amount) > 0.01) return false;
      const gap = Math.abs(Date.parse(`${t.txn_date}T00:00:00Z`) - Date.parse(`${line.line_date}T00:00:00Z`));
      return Number.isFinite(gap) && gap <= 60 * 86400000;
    });
    return { line, best, others, posted: near };
  });

  return { lines, candidates };
}

export interface ReconcileInput {
  invoiceId?: string | null;
  saleId?: string | null;
  /** Lançamento avulso, para o que nenhum documento cobre. */
  description?: string | null;
  accountCode?: string | null;
  reason?: "match" | "rule" | "memory" | "prediction" | "manual";
}

/** Confirms a match: creates the transaction and links it to the line. */
export async function reconcileLine(
  accountId: string, clientId: string, lineId: string,
  input: ReconcileInput, userId: string | null
): Promise<{ ok: boolean; error?: string }> {
  const { data: line } = await sb()
    .from("bank_statement_lines").select("*").eq("id", lineId)
    .eq("bank_account_id", accountId).maybeSingle();
  if (!line) return { ok: false, error: "Linha não encontrada nesta conta." };
  const l = line as StoredStatementLine;
  if (l.status === "reconciled") return { ok: false, error: "Esta linha já está conciliada." };

  if (input.invoiceId && input.saleId) {
    return { ok: false, error: "Uma linha liquida uma nota ou uma venda, nunca as duas." };
  }

  const amount = money(l.amount);
  const { error } = await sb().from("bank_transactions").insert({
    bank_account_id: accountId,
    client_id: clientId,
    txn_date: l.line_date,
    description: input.description?.trim() || l.description,
    contact_name: l.payee,
    amount,
    kind: amount < 0 ? "spend" : "receive",
    account_code: input.accountCode?.trim() || null,
    invoice_id: input.invoiceId ?? null,
    sale_id: input.saleId ?? null,
    statement_line_id: l.id,
    reconciled_at: new Date().toISOString(),
    reason: input.reason ?? "manual",
    created_by: userId,
  });
  if (error) return { ok: false, error: error.message };

  await sb().from("bank_statement_lines")
    .update({ status: "reconciled", reconciled_at: new Date().toISOString() })
    .eq("id", l.id);
  return { ok: true };
}

/**
 * Desconciliar: the link goes, the money stays posted.
 *
 * The transaction becomes an outstanding payment — it shows up in the closing
 * report as "posted here but not seen on the statement", which is exactly the
 * state it is in.
 */
export async function unlinkLine(
  accountId: string, lineId: string
): Promise<{ ok: boolean; affected: number }> {
  const { data } = await sb().from("bank_transactions")
    .update({ statement_line_id: null, reconciled_at: null })
    .eq("statement_line_id", lineId).eq("bank_account_id", accountId).select("id");
  await sb().from("bank_statement_lines")
    .update({ status: "unreconciled", reconciled_at: null }).eq("id", lineId);
  return { ok: true, affected: (data ?? []).length };
}

/** Refazer: the transaction is deleted and the document goes back to owing. */
export async function undoLine(
  accountId: string, lineId: string
): Promise<{ ok: boolean; affected: number }> {
  const { data } = await sb().from("bank_transactions").delete()
    .eq("statement_line_id", lineId).eq("bank_account_id", accountId).select("id");
  await sb().from("bank_statement_lines")
    .update({ status: "unreconciled", reconciled_at: null }).eq("id", lineId);
  return { ok: true, affected: (data ?? []).length };
}

/** Transactions posted here that no statement line accounts for yet. */
export async function outstandingTransactions(accountId: string): Promise<PostedPayment[]> {
  const { data } = await sb().from("bank_transactions")
    .select("id,txn_date,description,contact_name,amount,invoice_id,sale_id,reason")
    .eq("bank_account_id", accountId).is("statement_line_id", null)
    .order("txn_date", { ascending: false }).limit(200);
  return (data ?? []) as PostedPayment[];
}

/**
 * Links a line to a payment that is already posted, without creating anything.
 *
 * This is the other half of "desconciliar": the money was already recorded, and
 * what was missing was only the proof that the bank saw it too. Lançar de novo
 * seria contar o mesmo pagamento duas vezes.
 */
export async function linkExistingTransaction(
  accountId: string, lineId: string, txnId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: line } = await sb()
    .from("bank_statement_lines").select("id,status,amount")
    .eq("id", lineId).eq("bank_account_id", accountId).maybeSingle();
  if (!line) return { ok: false, error: "Linha não encontrada nesta conta." };
  if ((line as any).status === "reconciled") return { ok: false, error: "Esta linha já está conciliada." };

  const { data: txn } = await sb()
    .from("bank_transactions").select("id,amount,statement_line_id")
    .eq("id", txnId).eq("bank_account_id", accountId).maybeSingle();
  if (!txn) return { ok: false, error: "Movimento não encontrado nesta conta." };
  if ((txn as any).statement_line_id) return { ok: false, error: "Esse movimento já está ligado a outra linha." };

  const { error } = await sb().from("bank_transactions")
    .update({ statement_line_id: lineId, reconciled_at: new Date().toISOString() })
    .eq("id", txnId);
  if (error) return { ok: false, error: error.message };

  await sb().from("bank_statement_lines")
    .update({ status: "reconciled", reconciled_at: new Date().toISOString() }).eq("id", lineId);
  return { ok: true };
}
