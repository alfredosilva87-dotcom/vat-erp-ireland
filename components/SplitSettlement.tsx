"use client";

/**
 * Uma linha do extrato liquidando vários documentos (camada A4).
 *
 * O painel mostra, o tempo todo, **quanto já foi aplicado e quanto falta para
 * fechar**. É o número que decide se a conciliação pode ser gravada, então ele
 * fica visível o tempo inteiro em vez de aparecer como erro depois de clicar.
 *
 * Diferença de centavos vira um lançamento próprio, numa conta de
 * arredondamento escolhida aqui — nunca é somada no valor de uma das notas,
 * porque isso faria a nota parecer paga por um valor que ninguém emitiu.
 */

import { useMemo, useState } from "react";
import { planSettlement, planToAllocations, ROUNDING_TOLERANCE } from "@/lib/bankSplit";
import type { MatchCandidate } from "@/lib/bankMatch";

const money = (n: number) =>
  n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SplitSettlement({
  lineAmount, candidates, accounts, busy, onCancel, onConfirm,
}: {
  lineAmount: number;
  candidates: MatchCandidate[];
  accounts: { code: string; description: string }[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (parts: Array<{
    invoiceId?: string | null; saleId?: string | null; accountCode?: string | null;
    amount: number; description?: string | null;
  }>) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({}); // id -> valor digitado ("" = automático)
  const [roundingAccount, setRoundingAccount] = useState("");
  const [adjustAccount, setAdjustAccount] = useState("");
  const [search, setSearch] = useState("");

  const chosen = useMemo(
    () => candidates.filter((c) => c.id in picked),
    [candidates, picked]
  );

  const plan = useMemo(
    () => planSettlement(
      lineAmount,
      chosen.map((c) => ({
        key: c.id,
        outstanding: c.outstanding,
        amount: picked[c.id] === "" ? null : Number(String(picked[c.id]).replace(",", ".")),
      }))
    ),
    [lineAmount, chosen, picked]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? candidates.filter((c) =>
          `${c.party ?? ""} ${c.doc_number ?? ""}`.toLowerCase().includes(q))
      : candidates;
    // O que já foi marcado fica sempre à vista, mesmo se a busca mudar.
    return [...chosen, ...list.filter((c) => !(c.id in picked))].slice(0, 40);
  }, [candidates, search, chosen, picked]);

  function toggle(c: MatchCandidate) {
    setPicked((prev) => {
      const next = { ...prev };
      if (c.id in next) delete next[c.id];
      else next[c.id] = "";
      return next;
    });
  }

  function confirm() {
    const parts = planToAllocations(
      lineAmount, plan,
      chosen.map((c) => ({
        key: c.id,
        invoiceId: c.kind === "invoice" ? c.id : null,
        saleId: c.kind === "sale" ? c.id : null,
      })),
      roundingAccount || null
    );
    // Tarifa bancária, juro, desconto: o que sobra vira um lançamento próprio,
    // na conta que o contador escolheu. Continua valendo a regra de ouro — a
    // soma das partes é a linha.
    if (plan.unexplained !== null && adjustAccount) {
      parts.push({
        accountCode: adjustAccount,
        amount: plan.unexplained,
        description: "Diferença lançada na conciliação",
      });
    }
    onConfirm(parts);
  }

  const falta = plan.leftover;
  const canSave = plan.balanced || (plan.unexplained !== null && !!adjustAccount);

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-2/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="label">Dividir esta linha entre documentos</p>
        <p className="text-sm">
          <span className="text-muted">aplicado</span>{" "}
          <strong className="tnum">€ {money(plan.assigned)}</strong>
          <span className="mx-2 text-muted">·</span>
          <span className={Math.abs(falta) < 0.005 ? "text-muted" : "text-danger"}>
            falta <strong className="tnum">€ {money(falta)}</strong>
          </span>
        </p>
      </div>

      <input className="input mt-2 h-9" placeholder="Buscar por fornecedor, cliente ou número"
        value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        {visible.map((c) => {
          const on = c.id in picked;
          const part = plan.parts.find((p) => p.key === c.id);
          return (
            <div key={c.id} className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 ${on ? "bg-surface" : ""}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(c)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {c.party || "(sem nome)"}
                  <span className="ml-2 chip text-xs">{c.kind === "invoice" ? "compra" : "venda"}</span>
                </span>
                <span className="block text-xs text-muted">
                  {c.doc_number || "sem número"} · {c.doc_date || "sem data"} · em aberto € {money(c.outstanding)}
                </span>
              </span>
              {on && (
                <>
                  <input className="input h-8 w-28 text-right" placeholder="automático"
                    value={picked[c.id]} onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.value }))} />
                  {part?.partial && part.amount > 0 && (
                    <span className="text-xs text-muted">restam € {money(part.remaining)}</span>
                  )}
                </>
              )}
            </div>
          );
        })}
        {!visible.length && <p className="px-2 py-3 text-sm text-muted">Nenhum documento em aberto.</p>}
      </div>

      {plan.rounding !== null && (
        <div className="mt-2 rounded-lg bg-brand/5 px-3 py-2">
          <p className="text-xs text-muted">
            Sobra de € {money(plan.rounding)} — dentro de {ROUNDING_TOLERANCE.toFixed(2)}, tratada como
            arredondamento. Vai como lançamento próprio, não somada em nenhuma nota.
          </p>
          <select className="input mt-1 h-8" value={roundingAccount}
            onChange={(e) => setRoundingAccount(e.target.value)}>
            <option value="">— conta de arredondamento —</option>
            {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.description}</option>)}
          </select>
        </div>
      )}

      {plan.unexplained !== null && (
        <div className="mt-2 rounded-lg bg-surface px-3 py-2">
          <p className="text-xs text-muted">
            Sobra de € {money(plan.unexplained)} — grande demais para arredondamento. Se for tarifa
            bancária, juro ou desconto, escolha a conta e ela vira um lançamento à parte.
          </p>
          <select className="input mt-1 h-8" value={adjustAccount}
            onChange={(e) => setAdjustAccount(e.target.value)}>
            <option value="">— lançar a diferença em… —</option>
            {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.description}</option>)}
          </select>
        </div>
      )}

      {plan.warnings.map((w, i) => (
        <p key={i} className="mt-2 text-xs text-danger">⚠ {w}</p>
      ))}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-primary h-9 px-4 text-sm" disabled={busy || !canSave || !chosen.length}
          onClick={confirm}>
          Conciliar {chosen.length} documento(s)
          {plan.unexplained !== null && adjustAccount && " + diferença"}
        </button>
        <button className="btn-ghost h-9 px-3 text-sm" onClick={onCancel}>Cancelar</button>
        {!canSave && (
          <span className="text-xs text-muted">
            Só dá para gravar quando a soma fecha com a linha.
          </span>
        )}
      </div>
    </div>
  );
}
