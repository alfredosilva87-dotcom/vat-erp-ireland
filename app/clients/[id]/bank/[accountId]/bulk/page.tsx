"use client";

/**
 * Conciliação em massa (camada A7).
 *
 * Serve para o que se repete e não tem documento: tarifa, juro, taxa de cartão.
 * **Nunca casa com nota ou venda** — e isso é ordem de trabalho, não limitação:
 * quem passa o lote primeiro consome com "tarifa bancária" linhas que eram
 * pagamento de nota, e a nota fica em aberto para sempre com o dinheiro já
 * lançado noutro lugar.
 *
 * Por isso a linha que tem proposta de documento aparece marcada e **fora da
 * seleção**, com o caminho de volta para a tela de conciliação.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { StoredStatementLine } from "@/lib/types";

const money = (n: number) =>
  Number(n).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Pending {
  line: StoredStatementLine;
  best: { candidate: { party: string | null } } | null;
  rule: { rule: { name: string }; allocations: Array<{ account_code: string | null; vat_rate: number | null }> } | null;
}

type SortKey = "date" | "description" | "amount";

export default function Bulk({ params }: { params: { id: string; accountId: string } }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [accounts, setAccounts] = useState<{ code: string; description: string }[]>([]);
  const [rows, setRows] = useState<Record<string, { on: boolean; account: string; vat: string; fromRule: boolean }>>({});
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "date", asc: false });
  const [applyAccount, setApplyAccount] = useState("");
  const [applyVat, setApplyVat] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const base = `/api/clients/${params.id}/bank-accounts/${params.accountId}`;

  const load = useCallback(async () => {
    const [r1, r2] = await Promise.all([
      fetch(`${base}/reconcile`, { cache: "no-store" }),
      fetch(`/api/clients/${params.id}/accounts`, { cache: "no-store" }),
    ]);
    if (r1.ok) {
      const d = await r1.json();
      const list: Pending[] = d.lines || [];
      setPending(list);
      // Regra que resolve a linha inteira numa conta só já entra preenchida —
      // é o que faz o segundo mês ser rápido. Regra com divisão fica de fora:
      // dividir é decisão de uma linha, não de lote.
      setRows(Object.fromEntries(list.map((p) => {
        const single = p.rule?.allocations.length === 1 ? p.rule.allocations[0] : null;
        return [p.line.id, {
          on: false,
          account: single?.account_code ?? "",
          vat: single?.vat_rate != null ? String(single.vat_rate) : "",
          fromRule: !!single,
        }];
      })));
    }
    if (r2.ok) {
      const d = await r2.json();
      setAccounts((d.accounts || []).map((a: any) => ({ code: a.code, description: a.description })));
    }
    setLoading(false);
  }, [base, params.id]);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? pending.filter((p) => `${p.line.description ?? ""} ${p.line.reference ?? ""}`.toLowerCase().includes(q))
      : pending;
    const dir = sort.asc ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sort.key === "amount") return (Number(a.line.amount) - Number(b.line.amount)) * dir;
      if (sort.key === "description") return String(a.line.description ?? "").localeCompare(String(b.line.description ?? "")) * dir;
      return a.line.line_date.localeCompare(b.line.line_date) * dir;
    });
  }, [pending, search, sort]);

  const selected = useMemo(
    () => visible.filter((p) => rows[p.line.id]?.on),
    [visible, rows]
  );
  const selectedTotal = selected.reduce((s, p) => s + Number(p.line.amount), 0);
  const semConta = selected.filter((p) => !rows[p.line.id]?.account).length;

  function set(id: string, patch: Partial<{ on: boolean; account: string; vat: string }>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function toggleAll(on: boolean) {
    setRows((prev) => {
      const next = { ...prev };
      // Linha com proposta de documento nunca entra na seleção em massa.
      for (const p of visible) if (!p.best) next[p.line.id] = { ...next[p.line.id], on };
      return next;
    });
  }

  function propagate() {
    if (!applyAccount && !applyVat) return;
    setRows((prev) => {
      const next = { ...prev };
      for (const p of selected) {
        next[p.line.id] = {
          ...next[p.line.id],
          account: applyAccount || next[p.line.id].account,
          vat: applyVat || next[p.line.id].vat,
        };
      }
      return next;
    });
  }

  async function gravar() {
    const items = selected.map((p) => ({
      lineId: p.line.id,
      accountCode: rows[p.line.id].account || null,
      vatRate: rows[p.line.id].vat || null,
      reason: rows[p.line.id].fromRule ? "rule" : "manual",
    }));
    setBusy(true);
    try {
      const res = await fetch(`${base}/lines/bulk`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const d = await res.json();
      setMsg(res.ok
        ? {
            text: `${d.done} linha(s) conciliada(s)` +
              (d.skipped?.length ? `, ${d.skipped.length} recusada(s): ${d.skipped.slice(0, 3).map((s: any) => s.reason).join("; ")}` : "") + ".",
            error: !!d.skipped?.length,
          }
        : { text: d.error || "Não foi possível gravar o lote.", error: true });
      await load();
    } finally { setBusy(false); }
  }

  const th = (key: SortKey, label: string, extra = "") => (
    <th className={`px-3 py-2 font-medium ${extra}`}>
      <button className="hover:text-fg" onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}>
        {label}{sort.key === key ? (sort.asc ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );

  if (loading) return <p className="card p-6 text-muted">Carregando…</p>;

  return (
    <div className="space-y-6">
      <div className="rise">
        <Link href={`/clients/${params.id}/bank/${params.accountId}`} className="text-xs font-medium text-brand-700">
          ← Conta bancária
        </Link>
        <h1 className="mt-0.5 font-display text-xl font-semibold tracking-tight">Conciliação em massa</h1>
        <p className="mt-1 text-muted">
          Para o que se repete e não tem documento: tarifa, juro, taxa de cartão. Cada linha vira um
          lançamento na conta escolhida. <strong>Não casa com nota nem venda</strong> — para isso,
          use a <Link href={`/clients/${params.id}/bank/${params.accountId}/reconcile`} className="text-brand-700">tela de conciliação</Link>,
          e faça isso <em>antes</em> do lote.
        </p>
      </div>

      <div className="card rise grid gap-3 p-4 sm:grid-cols-[1fr_220px_120px_auto]">
        <input className="input h-9" placeholder="Filtrar por descrição"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input h-9" value={applyAccount} onChange={(e) => setApplyAccount(e.target.value)}>
          <option value="">— conta para aplicar —</option>
          {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.description}</option>)}
        </select>
        <input className="input h-9 text-right" placeholder="VAT %"
          value={applyVat} onChange={(e) => setApplyVat(e.target.value)} />
        <button className="btn-ghost" onClick={propagate} disabled={!selected.length}>
          Aplicar às {selected.length} selecionada(s)
        </button>
      </div>

      {msg && (
        <p className={msg.error
          ? "rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
          : "text-sm text-brand-700"}>{msg.error ? "⚠ " : ""}{msg.text}</p>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2">
                  <input type="checkbox" onChange={(e) => toggleAll(e.target.checked)}
                    checked={!!visible.length && visible.filter((p) => !p.best).every((p) => rows[p.line.id]?.on)} />
                </th>
                {th("date", "Data")}
                {th("description", "Descrição")}
                {th("amount", "Valor €", "text-right")}
                <th className="px-3 py-2 font-medium">Conta</th>
                <th className="px-3 py-2 font-medium text-right">VAT %</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const r = rows[p.line.id];
                if (!r) return null;
                return (
                  <tr key={p.line.id} className={`border-b border-line/70 ${r.on ? "bg-surface-2/40" : ""}`}>
                    <td className="px-3 py-1.5">
                      <input type="checkbox" checked={r.on} disabled={!!p.best}
                        onChange={(e) => set(p.line.id, { on: e.target.checked })} />
                    </td>
                    <td className="px-3 py-1.5 tnum">{p.line.line_date}</td>
                    <td className="px-3 py-1.5">
                      {p.line.description || "—"}
                      {p.best && (
                        <span className="ml-2 chip text-xs">
                          tem documento: {p.best.candidate.party || "sem nome"}
                        </span>
                      )}
                      {r.fromRule && <span className="ml-2 chip text-xs">regra</span>}
                    </td>
                    <td className={`px-3 py-1.5 text-right tnum ${Number(p.line.amount) < 0 ? "text-danger" : "text-brand-700"}`}>
                      {money(p.line.amount)}
                    </td>
                    <td className="px-3 py-1.5">
                      <select className="input h-8" value={r.account} disabled={!!p.best}
                        onChange={(e) => set(p.line.id, { account: e.target.value })}>
                        <option value="">—</option>
                        {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.description}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-1.5">
                      <input className="input h-8 w-20 text-right" value={r.vat} disabled={!!p.best}
                        onChange={(e) => set(p.line.id, { vat: e.target.value })} />
                    </td>
                  </tr>
                );
              })}
              {!visible.length && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">
                  Nada por conciliar nesta conta.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={gravar} disabled={busy || !selected.length}>
          {busy ? "Gravando…" : `Conciliar ${selected.length} linha(s)`}
        </button>
        {!!selected.length && (
          <span className="text-sm text-muted">
            Total selecionado: <strong className="tnum">€ {money(selectedTotal)}</strong>
          </span>
        )}
        {semConta > 0 && (
          <span className="text-sm text-danger">
            {semConta} sem conta contábil — vão entrar sem destino, e alguém vai ter que voltar nelas.
          </span>
        )}
        {selected.length > 100 && (
          <span className="text-sm text-danger">
            Lote acima de 100 linhas: ninguém confere isso na tela. Vale fazer em partes.
          </span>
        )}
      </div>
    </div>
  );
}
