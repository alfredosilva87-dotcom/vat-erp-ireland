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

export interface PendingLine {
  line: StoredStatementLine;
  best: MatchSuggestion | null;
  others: MatchSuggestion[];
  posted: PostedPayment[];
}

export default function ReconcileRow({
  item, candidates, busy, onConfirm,
}: {
  item: PendingLine;
  candidates: MatchCandidate[];
  busy: boolean;
  onConfirm: (lineId: string, choice: {
    invoiceId?: string; saleId?: string; transactionId?: string; description?: string; reason: string;
  }) => void;
}) {
  const { line, best, others, posted } = item;
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
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

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button className="btn-primary h-9 px-3 text-sm" disabled={busy} onClick={() => confirm(chosen)}>
                Confirmar
              </button>
              {!!others.length && (
                <button className="btn-ghost h-9 px-3 text-sm" onClick={() => setOpen((v) => !v)}>
                  {open ? "Esconder" : `Outras correspondências possíveis (${others.length})`}
                </button>
              )}
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
              <button className="btn-ghost h-9 px-3 text-sm" onClick={() => setManual(true)}>Sem documento</button>
            </div>
          </div>
        )}

        {!manual && !!posted.length && (
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
