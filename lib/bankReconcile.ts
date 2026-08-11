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
import { applyRules, type RuleOutcome, type ResolvedAllocation } from "@/lib/bankRules";
import { listBankRules } from "@/lib/bankRulesStore";
import { periodLockError, lockedThrough } from "@/lib/bankClosingStore";
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
  /**
   * A regra que casou com esta linha, se alguma (camada A3).
   *
   * Regra **sugere**, nunca lança: vem preenchida na tela e espera confirmação.
   * Uma regra errada que lança sozinha vira mil lançamentos errados antes de
   * alguém olhar.
   */
  rule: RuleOutcome | null;
}

/** Lines still waiting, each with what the system would propose. */
export async function pendingWithSuggestions(
  accountId: string, clientId: string, limit = 200
): Promise<{ lines: LineWithSuggestions[]; candidates: MatchCandidate[] }> {
  const [{ data }, candidates, posted, rules] = await Promise.all([
    sb().from("bank_statement_lines").select("*")
      .eq("bank_account_id", accountId).eq("status", "unreconciled")
      .order("line_date", { ascending: false }).limit(limit),
    openDocuments(clientId),
    outstandingTransactions(accountId),
    listBankRules(clientId),
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
    const rule = applyRules(
      { description: line.description, payee: line.payee, reference: line.reference, amount },
      rules, accountId
    );
    return { line, best, others, posted: near, rule };
  });

  return { lines, candidates };
}

/**
 * Uma parte do valor da linha: pode liquidar um documento, ir para uma conta
 * contábil, ou as duas coisas em movimentos diferentes.
 */
export interface ReconcilePart {
  invoiceId?: string | null;
  saleId?: string | null;
  accountCode?: string | null;
  vatRate?: number | null;
  amount: number;
  description?: string | null;
}

export interface ReconcileInput {
  invoiceId?: string | null;
  saleId?: string | null;
  /** Lançamento avulso, para o que nenhum documento cobre. */
  description?: string | null;
  accountCode?: string | null;
  /**
   * Divisão em várias contas (vinda de uma regra da camada A3). Cada parcela
   * vira um movimento, e a soma tem que fechar com a linha — senão a
   * conciliação deixa de ser prova de coisa nenhuma.
   */
  allocations?: ResolvedAllocation[] | null;
  /**
   * Um pagamento cobrindo vários documentos, cada um com seu valor (camada A4).
   * Uma nota paga pela metade recebe metade e continua devendo o resto — é a
   * view `invoice_payment_status` que cuida disso sozinha, porque a situação de
   * pagamento é derivada e não um campo mantido à mão.
   */
  parts?: ReconcilePart[] | null;
  contactName?: string | null;
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

  const locked = await periodLockError(accountId, l.line_date);
  if (locked) return { ok: false, error: locked };

  if (input.invoiceId && input.saleId) {
    return { ok: false, error: "Uma linha liquida uma nota ou uma venda, nunca as duas." };
  }

  const amount = money(l.amount);

  // Uma parcela quando não há divisão; várias quando uma regra dividiu ou
  // quando a linha liquida mais de um documento.
  const parts: ReconcilePart[] = (input.parts ?? []).length
    ? input.parts!.map((p) => ({
        invoiceId: p.invoiceId ?? null,
        saleId: p.saleId ?? null,
        accountCode: p.accountCode ?? null,
        vatRate: p.vatRate ?? null,
        amount: money(p.amount),
        description: p.description ?? null,
      }))
    : (input.allocations ?? []).length
    ? input.allocations!.map((a) => ({
        invoiceId: input.invoiceId ?? null,
        saleId: input.saleId ?? null,
        accountCode: a.account_code ?? null,
        vatRate: a.vat_rate ?? null,
        amount: money(a.amount),
        description: a.description ?? null,
      }))
    : [{
        invoiceId: input.invoiceId ?? null,
        saleId: input.saleId ?? null,
        accountCode: input.accountCode?.trim() || null,
        vatRate: null,
        amount,
        description: null,
      }];

  if (parts.some((p) => p.invoiceId && p.saleId)) {
    return { ok: false, error: "Cada parte liquida uma nota ou uma venda, nunca as duas." };
  }

  // A soma das partes tem que ser a linha. Deixar passar uma divisão que não
  // fecha é criar dinheiro do nada dentro do sistema.
  const sum = money(parts.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(sum - amount) > 0.01) {
    return { ok: false, error: `A divisão soma ${sum.toFixed(2)}, e a linha é ${amount.toFixed(2)}.` };
  }

  const now = new Date().toISOString();
  const { error } = await sb().from("bank_transactions").insert(
    parts.map((p) => ({
      bank_account_id: accountId,
      client_id: clientId,
      txn_date: l.line_date,
      description: p.description || input.description?.trim() || l.description,
      contact_name: input.contactName?.trim() || l.payee,
      amount: p.amount,
      kind: p.amount < 0 ? "spend" : "receive",
      account_code: p.accountCode ?? null,
      vat_rate: p.vatRate ?? null,
      invoice_id: p.invoiceId ?? null,
      sale_id: p.saleId ?? null,
      statement_line_id: l.id,
      reconciled_at: now,
      reason: input.reason ?? "manual",
      created_by: userId,
    }))
  );
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
): Promise<{ ok: boolean; affected: number; error?: string }> {
  const locked = await lineLockError(accountId, lineId);
  if (locked) return { ok: false, affected: 0, error: locked };

  const { data } = await sb().from("bank_transactions")
    .update({ statement_line_id: null, reconciled_at: null })
    .eq("statement_line_id", lineId).eq("bank_account_id", accountId).select("id");
  await sb().from("bank_statement_lines")
    .update({ status: "unreconciled", reconciled_at: null }).eq("id", lineId);
  return { ok: true, affected: (data ?? []).length };
}

/** A data da linha, para o cadeado de período. */
async function lineLockError(accountId: string, lineId: string): Promise<string | null> {
  const { data } = await sb().from("bank_statement_lines").select("line_date")
    .eq("id", lineId).eq("bank_account_id", accountId).maybeSingle();
  const date = (data as any)?.line_date;
  return date ? periodLockError(accountId, date) : null;
}

/** Refazer: the transaction is deleted and the document goes back to owing. */
export async function undoLine(
  accountId: string, lineId: string
): Promise<{ ok: boolean; affected: number; error?: string }> {
  const locked = await lineLockError(accountId, lineId);
  if (locked) return { ok: false, affected: 0, error: locked };

  const { data } = await sb().from("bank_transactions").delete()
    .eq("statement_line_id", lineId).eq("bank_account_id", accountId).select("id");
  await sb().from("bank_statement_lines")
    .update({ status: "unreconciled", reconciled_at: null }).eq("id", lineId);
  return { ok: true, affected: (data ?? []).length };
}

export interface BulkItem {
  lineId: string;
  accountCode?: string | null;
  vatRate?: number | null;
  description?: string | null;
  reason?: "rule" | "manual";
}

export interface BulkOutcome {
  done: number;
  skipped: Array<{ lineId: string; reason: string }>;
}

/**
 * Conciliação em massa (camada A7).
 *
 * **Só cria lançamento avulso — nunca casa com documento**, e isso não é
 * limitação técnica, é a ordem certa do trabalho: quem passa o lote primeiro
 * consome com "tarifa bancária" linhas que eram pagamento de nota, e a nota
 * fica em aberto para sempre com o dinheiro já lançado noutro lugar. Documento
 * primeiro, lote depois.
 *
 * Faz tudo em duas idas ao banco em vez de uma por linha: cinquenta tarifas não
 * podem levar meio minuto, senão ninguém usa e volta a conciliar uma a uma.
 */
export async function bulkSpend(
  accountId: string, clientId: string, items: BulkItem[], userId: string | null
): Promise<BulkOutcome> {
  const skipped: Array<{ lineId: string; reason: string }> = [];
  if (!items.length) return { done: 0, skipped };

  const ids = items.map((i) => i.lineId);
  const [{ data: lines }, until] = await Promise.all([
    sb().from("bank_statement_lines").select("id,line_date,amount,description,payee,status")
      .eq("bank_account_id", accountId).in("id", ids),
    lockedThrough(accountId),
  ]);

  const byId = new Map((lines ?? []).map((l: any) => [l.id, l]));
  const now = new Date().toISOString();
  const rows: any[] = [];
  const okIds: string[] = [];

  for (const item of items) {
    const l = byId.get(item.lineId);
    if (!l) { skipped.push({ lineId: item.lineId, reason: "Linha não encontrada nesta conta." }); continue; }
    if (l.status === "reconciled") { skipped.push({ lineId: item.lineId, reason: "Já estava conciliada." }); continue; }
    if (until && l.line_date <= until) {
      skipped.push({ lineId: item.lineId, reason: `Período fechado até ${until}.` });
      continue;
    }

    const amount = money(l.amount);
    rows.push({
      bank_account_id: accountId,
      client_id: clientId,
      txn_date: l.line_date,
      description: item.description?.trim() || l.description,
      contact_name: l.payee,
      amount,
      kind: amount < 0 ? "spend" : "receive",
      account_code: item.accountCode?.trim() || null,
      vat_rate: item.vatRate ?? null,
      invoice_id: null,
      sale_id: null,
      statement_line_id: l.id,
      reconciled_at: now,
      reason: item.reason ?? "manual",
      created_by: userId,
    });
    okIds.push(l.id);
  }

  if (!rows.length) return { done: 0, skipped };

  const { error } = await sb().from("bank_transactions").insert(rows);
  if (error) return { done: 0, skipped: [...skipped, { lineId: "*", reason: error.message }] };

  await sb().from("bank_statement_lines")
    .update({ status: "reconciled", reconciled_at: now }).in("id", okIds);

  return { done: okIds.length, skipped };
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

  const locked = await lineLockError(accountId, lineId);
  if (locked) return { ok: false, error: locked };

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
