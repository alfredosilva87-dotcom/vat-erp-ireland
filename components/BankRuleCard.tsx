"use client";

/**
 * Uma regra de banco, editável no lugar.
 *
 * A posição na fila aparece como número e com setas ao lado: a ordem é parte do
 * significado da regra — a primeira que casa ganha e as outras nem são olhadas
 * — então esconder isso num campo "prioridade" seria esconder o comportamento.
 */

import { useState } from "react";
import type { BankRule, RuleAllocation, RuleCondition, RuleField, RuleOp } from "@/lib/bankRules";

const FIELDS: { v: RuleField; label: string }[] = [
  { v: "description", label: "Descrição" },
  { v: "payee", label: "Beneficiário" },
  { v: "reference", label: "Referência" },
  { v: "amount", label: "Valor" },
];

const TEXT_OPS: { v: RuleOp; label: string }[] = [
  { v: "contains", label: "contém" },
  { v: "starts_with", label: "começa com" },
  { v: "equals", label: "é igual a" },
];
const NUM_OPS: { v: RuleOp; label: string }[] = [
  { v: "equals", label: "é igual a" },
  { v: "gt", label: "acima de" },
  { v: "lt", label: "abaixo de" },
];

export default function BankRuleCard({
  rule, position, total, accounts, shadowedBy, busy, onSave, onMove, onDelete,
}: {
  rule: BankRule;
  position: number;
  total: number;
  accounts: { code: string; description: string }[];
  shadowedBy: string | null;
  busy: boolean;
  onSave: (id: string, patch: Partial<BankRule>) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BankRule>(rule);

  const set = (patch: Partial<BankRule>) => setDraft((d) => ({ ...d, ...patch }));
  const conds = draft.conditions ?? [];
  const allocs = draft.allocations ?? [];

  const percentTotal = allocs.reduce((s, a) => s + (a.percent ? Number(a.percent) : 0), 0);

  return (
    <div className={`card p-4 ${draft.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex flex-col items-center">
            <button className="btn-ghost h-6 px-2 text-xs" disabled={busy || position === 1}
              onClick={() => onMove(rule.id, "up")}>▲</button>
            <span className="py-0.5 text-xs font-medium text-muted tnum">{position}</span>
            <button className="btn-ghost h-6 px-2 text-xs" disabled={busy || position === total}
              onClick={() => onMove(rule.id, "down")}>▼</button>
          </div>
          <div className="min-w-0">
            <p className="font-medium">{draft.name}</p>
            <p className="mt-0.5 text-sm text-muted">
              {conds.length
                ? `${draft.match_all ? "Todas" : "Qualquer"}: ` +
                  conds.map((c) => `${labelOf(c.field)} ${opLabel(c)} “${c.value}”`).join(draft.match_all ? " e " : " ou ")
                : "Sem condição — esta regra nunca vai casar."}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {allocs.length
                ? allocs.map((a) => `${a.account_code || "sem conta"} ${a.percent != null ? `${a.percent}%` : a.amount != null ? `€${a.amount}` : "resto"}`).join(" · ")
                : "Sem destino contábil."}
              {draft.bank_account_id ? " · só numa conta" : " · todas as contas"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex flex-wrap items-center gap-1 text-xs text-muted">
            <input type="checkbox" checked={draft.active}
              onChange={(e) => { set({ active: e.target.checked }); onSave(rule.id, { active: e.target.checked }); }} />
            ativa
          </label>
          <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setOpen((v) => !v)}>
            {open ? "Fechar" : "Editar"}
          </button>
        </div>
      </div>

      {shadowedBy && (
        <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          ⚠ Esta regra nunca vai acontecer: “{shadowedBy}” está acima dela e casa com tudo que ela casaria.
          Suba esta ou restrinja aquela.
        </p>
      )}

      {open && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
            <label className="block">
              <span className="mb-1 block text-xs text-muted">Nome da regra</span>
              <input className="input h-9" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">Casar quando</span>
              <select className="input h-9" value={draft.match_all ? "all" : "any"}
                onChange={(e) => set({ match_all: e.target.value === "all" })}>
                <option value="all">todas as condições</option>
                <option value="any">qualquer condição</option>
              </select>
            </label>
          </div>

          <div>
            <p className="label mb-2">Condições</p>
            {conds.map((c, i) => (
              <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[150px_150px_1fr_auto]">
                <select className="input h-9" value={c.field}
                  onChange={(e) => setCond(i, { field: e.target.value as RuleField })}>
                  {FIELDS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
                </select>
                <select className="input h-9" value={c.op}
                  onChange={(e) => setCond(i, { op: e.target.value as RuleOp })}>
                  {(c.field === "amount" ? NUM_OPS : TEXT_OPS).map((o) => (
                    <option key={o.v} value={o.v}>{o.label}</option>
                  ))}
                </select>
                <input className="input h-9" value={c.value}
                  onChange={(e) => setCond(i, { value: e.target.value })} />
                <button className="btn-ghost h-9 px-3 text-xs text-danger"
                  onClick={() => set({ conditions: conds.filter((_, k) => k !== i) })}>Remover</button>
              </div>
            ))}
            <button className="btn-ghost h-8 px-3 text-xs"
              onClick={() => set({ conditions: [...conds, { field: "description", op: "contains", value: "" }] })}>
              + Condição
            </button>
          </div>

          <div>
            <p className="label mb-2">Destino</p>
            {allocs.map((a, i) => (
              <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_110px_110px_110px_auto]">
                <select className="input h-9" value={a.account_code ?? ""}
                  onChange={(e) => setAlloc(i, { account_code: e.target.value || null })}>
                  <option value="">— conta —</option>
                  {accounts.map((ac) => (
                    <option key={ac.code} value={ac.code}>{ac.code} · {ac.description}</option>
                  ))}
                </select>
                <input className="input h-9 text-right" placeholder="VAT %"
                  value={a.vat_rate ?? ""} onChange={(e) => setAlloc(i, { vat_rate: numOrNull(e.target.value) })} />
                <input className="input h-9 text-right" placeholder="%"
                  value={a.percent ?? ""} onChange={(e) => setAlloc(i, { percent: numOrNull(e.target.value), amount: null })} />
                <input className="input h-9 text-right" placeholder="€ fixo"
                  value={a.amount ?? ""} onChange={(e) => setAlloc(i, { amount: numOrNull(e.target.value), percent: null })} />
                <button className="btn-ghost h-9 px-3 text-xs text-danger"
                  onClick={() => set({ allocations: allocs.filter((_, k) => k !== i) })}>Remover</button>
              </div>
            ))}
            <button className="btn-ghost h-8 px-3 text-xs"
              onClick={() => set({ allocations: [...allocs, { account_code: null, vat_rate: null, percent: null, amount: null }] })}>
              + Parcela
            </button>
            {allocs.length > 1 && percentTotal > 0 && Math.abs(percentTotal - 100) > 0.01 && (
              <p className="mt-2 text-xs text-danger">
                Os percentuais somam {percentTotal}%. Deixe uma parcela sem percentual para receber o resto,
                ou feche em 100%.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary h-9 px-4 text-sm" disabled={busy}
              onClick={() => { onSave(rule.id, draft); setOpen(false); }}>Salvar</button>
            <button className="btn-ghost h-9 px-3 text-sm" onClick={() => { setDraft(rule); setOpen(false); }}>Cancelar</button>
            <button className="btn-ghost ml-auto h-9 px-3 text-sm text-danger" disabled={busy}
              onClick={() => onDelete(rule.id)}>Apagar regra</button>
          </div>
        </div>
      )}
    </div>
  );

  function setCond(i: number, patch: Partial<RuleCondition>) {
    set({ conditions: conds.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  }
  function setAlloc(i: number, patch: Partial<RuleAllocation>) {
    set({ allocations: allocs.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
  }
}

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const labelOf = (f: RuleField) => FIELDS.find((x) => x.v === f)?.label ?? f;
const opLabel = (c: RuleCondition) =>
  (c.field === "amount" ? NUM_OPS : TEXT_OPS).find((o) => o.v === c.op)?.label ?? c.op;
