"use client";

/**
 * Uma linha do extrato ao lado do que o sistema propõe para ela.
 *
 * Duas colunas: à esquerda o que o banco disse (imutável), à direita o que vai
 * ser lançado. É o formato do Xero, e a razão é que o contador precisa ver os
 * dois lados ao mesmo tempo para decidir em um segundo.
 *
 * O motivo da proposta fica visível de propósito. "Número 2026-014 aparece na
 * descrição" é conferível; uma pontuação sozinha só pede fé.
 */

import { useState } from "react";
import SplitSettlement from "@/components/SplitSettlement";
import type { MatchCandidate, MatchSuggestion } from "@/lib/bankMatch";
import type { StoredStatementLine } from "@/lib/types";

const money = (n: number) =>
  n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface PostedPayment {
  id: string;
  txn_date: string;
  description: string | null;
  contact_name: string | null;
  amount: number;
}

export interface RuleProposal {
  rule: { id: string; name: string };
  allocations: Array<{ account_code: string | null; vat_rate: number | null; amount: number }>;
  shadowed: Array<{ id: string; name: string }>;
}

export interface PendingLine {
  line: StoredStatementLine;
  best: MatchSuggestion | null;
  others: MatchSuggestion[];
  posted: PostedPayment[];
  rule: RuleProposal | null;
}

export default function ReconcileRow({
  item, candidates, accounts, busy, onConfirm,
}: {
  accounts?: { code: string; description: string }[];
  item: PendingLine;
  candidates: MatchCandidate[];
  busy: boolean;
  onConfirm: (lineId: string, choice: {
    invoiceId?: string; saleId?: string; transactionId?: string; description?: string;
    allocations?: Array<{ account_code: string | null; vat_rate: number | null; amount: number }>;
    parts?: Array<{ invoiceId?: string | null; saleId?: string | null; accountCode?: string | null; amount: number }>;
    reason: string;
  }) => void;
}) {
  const { line, best, others, posted, rule } = item;
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [split, setSplit] = useState(false);
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const amount = Number(line.amount);
  const chosen =
    picked
      ? [best, ...others].find((s) => s && s.candidate.id === picked) ?? null
      : best;

  function confirm(sug: MatchSuggestion) {
    onConfirm(line.id, {
      [sug.candidate.kind === "invoice" ? "invoiceId" : "saleId"]: sug.candidate.id,
      // O motivo fica gravado: casamento proposto pelo sistema não é a mesma
      // coisa que escolha feita na mão, e no fechamento isso importa.
      reason: sug === best && !picked ? "match" : "manual",
    } as any);
  }

  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-2">
      {/* O que o banco disse */}
      <div className="bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{line.description || "—"}</p>
            <p className="mt-0.5 text-sm text-muted">
              <span className="tnum">{line.line_date}</span>
              {line.reference && <span className="ml-2 font-mono text-xs">{line.reference}</span>}
            </p>
          </div>
          <span className={`shrink-0 font-display text-xl font-semibold tnum ${amount < 0 ? "text-danger" : "text-brand-700"}`}>
            € {money(amount)}
          </span>
        </div>
      </div>

      {/* O que vai ser lançado */}
      <div className="bg-surface p-4">
        {manual ? (
          <div className="space-y-2">
            <input className="input h-9" placeholder="Descrição do lançamento"
              value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-primary h-9 px-3 text-sm" disabled={busy}
                onClick={() => onConfirm(line.id, { description: note || line.description || "", reason: "manual" })}>
                Lançar sem documento
              </button>
              <button className="btn-ghost h-9 px-3 text-sm" onClick={() => setManual(false)}>Voltar</button>
            </div>
            <p className="text-xs text-muted">
              Cria o movimento no sistema sem ligar a nota ou venda. Use para tarifa, juro e afins.
            </p>
          </div>
        ) : chosen ? (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {chosen.candidate.party || "(sem nome)"}
                  <span className="ml-2 chip text-xs">
                    {chosen.candidate.kind === "invoice" ? "compra" : "venda"}
                  </span>
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {chosen.candidate.doc_number && <span className="font-mono text-xs">{chosen.candidate.doc_number}</span>}
                  {chosen.candidate.doc_date && <span className="ml-2 tnum">{chosen.candidate.doc_date}</span>}
                </p>
              </div>
              <span className="shrink-0 text-right">
                <span className="font-display text-lg font-semibold tnum">€ {money(chosen.candidate.outstanding)}</span>
                <span className="block text-xs text-muted">em aberto</span>
              </span>
            </div>

            <ul className="space-y-0.5 text-xs text-muted">
              {chosen.reasons.map((r, i) => (
                <li key={i} className={r.startsWith("Aten") ? "text-danger" : ""}>· {r}</li>
              ))}
            </ul>

            {/*
              * O QUE CONFIRMAR VAI FAZER, em números, antes de se clicar.
              *
              * O ecrã mostrava o valor da linha de um lado e o em aberto do
              * documento do outro, e deixava a subtracção para a cabeça de
              * quem confere. Quando os dois são iguais não custa nada; quando
              * são diferentes — pagamento parcial, ou o documento errado — é
              * exactamente aí que a conta importa e é aí que ninguém a faz.
              *
              * Sobra > 0 é pagamento parcial, e é normal. Sobra < 0 é a linha
              * a pagar MAIS do que o documento deve: ou não é este documento,
              * ou faltam encargos lançados. Essa merece vermelho.
              */}
            {(() => {
              const paga = Math.abs(Number(item.line.amount) || 0);
              const devido = Math.abs(Number(chosen.candidate.outstanding) || 0);
              const sobra = Math.round((devido - paga) * 100) / 100;
              if (Math.abs(sobra) <= 0.01) {
                return (
                  <p className="rounded-lg bg-success-50 px-3 py-2 text-xs text-success">
                    Confirmar liquida o documento por inteiro: € {money(paga)} de € {money(devido)}.
                  </p>
                );
              }
              if (sobra > 0) {
                return (
                  <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
                    Confirmar baixa <b className="text-ink">€ {money(paga)}</b> dos € {money(devido)} em
                    aberto. Ficam <b className="text-ink">€ {money(sobra)}</b> por liquidar.
                  </p>
                );
              }
              return (
                <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
                  ⚠ A linha paga € {money(paga)} e o documento só deve € {money(devido)} —
                  € {money(-sobra)} a mais. Ou não é este documento, ou faltam encargos lançados nele.
                </p>
              );
            })()}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button className="btn-primary h-9 px-3 text-sm" disabled={busy} onClick={() => confirm(chosen)}>
                Confirmar
              </button>
              {!!others.length && (
                <button className="btn-ghost h-9 px-3 text-sm" onClick={() => setOpen((v) => !v)}>
                  {open ? "Esconder" : `Outras correspondências possíveis (${others.length})`}
                </button>
              )}
              <button className="btn-ghost h-9 px-3 text-sm" onClick={() => setSplit(true)}>Várias notas / dividir</button>
              <button className="btn-ghost h-9 px-3 text-sm" onClick={() => setManual(true)}>Sem documento</button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted">
              {others.length
                ? "Nenhuma proposta com confiança suficiente — escolha abaixo."
                : "Nenhum documento em aberto parecido com esta linha."}
            </p>
            <div className="flex flex-wrap gap-2">
              {!!others.length && (
                <button className="btn-ghost h-9 px-3 text-sm" onClick={() => setOpen((v) => !v)}>
                  {open ? "Esconder" : `Ver ${others.length} possível(is)`}
                </button>
              )}
              <button className="btn-ghost h-9 px-3 text-sm" onClick={() => setSplit(true)}>Várias notas / dividir</button>
              <button className="btn-ghost h-9 px-3 text-sm" onClick={() => setManual(true)}>Sem documento</button>
            </div>
          </div>
        )}

        {split && (
          <SplitSettlement
            lineAmount={amount}
            candidates={candidates}
            accounts={accounts ?? []}
            busy={busy}
            onCancel={() => setSplit(false)}
            onConfirm={(parts) => { setSplit(false); onConfirm(line.id, { parts, reason: "manual" }); }}
          />
        )}

        {!manual && !split && rule && (
          <div className="mt-3 rounded-lg border border-line bg-surface-2/50 px-3 py-2">
            <p className="text-xs text-muted">
              Regra <strong className="text-fg">{rule.rule.name}</strong>
              {rule.shadowed.length > 0 && ` · ${rule.shadowed.length} regra(s) abaixo dela também casariam`}
            </p>
            <ul className="mt-1 space-y-0.5 text-sm">
              {rule.allocations.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span>{a.account_code || "(sem conta)"}{a.vat_rate != null && ` · VAT ${a.vat_rate}%`}</span>
                  <span className="tnum">€ {money(a.amount)}</span>
                </li>
              ))}
            </ul>
            <button className="btn-primary mt-2 h-8 px-3 text-xs" disabled={busy}
              onClick={() => onConfirm(line.id, { allocations: rule.allocations, reason: "rule" })}>
              Lançar pela regra
            </button>
          </div>
        )}

        {!manual && !split && !!posted.length && (
          <div className="mt-3 rounded-lg bg-brand/5 px-3 py-2">
            <p className="text-xs text-muted">
              Já existe movimento lançado com este valor. Ligar não lança nada de novo.
            </p>
            {posted.map((t) => (
              <div key={t.id} className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  {t.description || t.contact_name || "(sem descrição)"}
                  <span className="ml-2 text-xs text-muted tnum">{t.txn_date}</span>
                </span>
                <button className="btn-ghost h-8 px-3 text-xs" disabled={busy}
                  onClick={() => onConfirm(line.id, { transactionId: t.id, reason: "manual" })}>
                  Ligar a este pagamento
                </button>
              </div>
            ))}
          </div>
        )}

        {open && (
          <div className="mt-3 space-y-1 border-t border-line pt-3">
            {others.map((s) => (
              <button key={s.candidate.id}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2 ${
                  picked === s.candidate.id ? "bg-surface-2" : ""
                }`}
                onClick={() => { setPicked(s.candidate.id); setOpen(false); }}>
                <span className="min-w-0">
                  <span className="block truncate">{s.candidate.party || "(sem nome)"}</span>
                  <span className="block text-xs text-muted">
                    {s.candidate.doc_number || "sem número"} · {s.candidate.doc_date || "sem data"}
                  </span>
                </span>
                <span className="shrink-0 tnum">€ {money(s.candidate.outstanding)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
