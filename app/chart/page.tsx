"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * O plano de contas DO ESCRITÓRIO — o mesmo para todos os clientes.
 *
 * Vive no menu geral, e não dentro de um cliente, porque é de todos: editá-lo
 * de dentro de uma empresa pareceria estar a mexer só naquela, quando mexe nas
 * trinta e cinco. Mesma razão que pôs o RH aqui fora.
 *
 * A tela diz isso em voz alta no topo. Um plano partilhado onde alguém acha
 * que está a mexer num cliente só é a forma mais rápida de estragar o plano
 * de todos.
 *
 * Contas PRÓPRIAS de um cliente (faixa 9000–9899) não se criam aqui — criam-se
 * dentro do cliente, em Contabilidade → Plano de contas.
 */

type Conta = {
  id: string; code: string; description: string; type: string | null;
  report_group: string | null; postable: boolean; active: boolean;
};

const TIPOS = [
  { v: "asset", r: "Ativo" }, { v: "liability", r: "Passivo" },
  { v: "equity", r: "Património" }, { v: "revenue", r: "Receita" },
  { v: "expense", r: "Despesa" },
];

const GRUPOS = [
  "fixed_assets_tangible", "fixed_assets_intangible", "stocks", "debtors", "cash",
  "creditors_within_1y", "creditors_after_1y", "provisions", "share_capital",
  "reserves", "profit_loss_account", "turnover", "cost_of_sales",
  "other_operating_income", "distribution_costs", "administrative_expenses",
  "interest_and_similar", "tax_on_profit",
];

const NOME_TIPO: Record<string, string> = Object.fromEntries(TIPOS.map((t) => [t.v, t.r]));

export default function ChartOfAccounts() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [nova, setNova] = useState({
    code: "", description: "", type: "expense", report_group: "administrative_expenses",
  });

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/chart", { cache: "no-store" });
      if (r.ok) setContas((await r.json()).accounts || []);
    } finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return contas;
    return contas.filter((c) =>
      c.code.includes(q) || c.description.toLowerCase().includes(q));
  }, [contas, busca]);

  async function criar() {
    setErro(null);
    const r = await fetch("/api/chart", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nova),
    });
    const d = await r.json();
    if (!r.ok) { setErro(d.error || "Não gravou."); return; }
    setNova({ ...nova, code: "", description: "" });
    carregar();
  }

  async function alternarAtiva(c: Conta) {
    await fetch("/api/chart", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, active: !c.active }),
    });
    carregar();
  }

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Plano de contas</h1>
        <p className="mt-1 text-muted">
          É o plano do escritório — o mesmo para todos os clientes. O que se muda aqui vale para todos.
        </p>
      </div>

      {/*
        O aviso é curto e fica no topo porque a confusão que ele evita é cara:
        alguém a pensar que está a arrumar o plano de um cliente e a mexer nos
        trinta e cinco.
      */}
      <div className="card border-l-4 border-l-brand p-4 text-sm">
        Contas <b>próprias de um cliente</b> não se criam aqui. Elas vivem na faixa{" "}
        <span className="font-mono">9000–9899</span> e criam-se dentro do cliente, em{" "}
        <b>Contabilidade → Plano de contas</b>. Aqui fica a espinha que todos partilham.
      </div>

      <section className="card p-5">
        <h2 className="font-display text-lg font-semibold">Nova conta do escritório</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[110px_minmax(0,1fr)_150px_minmax(0,1fr)_auto] sm:items-end">
          <label className="flex flex-col leading-tight">
            <span className="label">Código</span>
            <input className="input w-full font-mono text-[13px]" value={nova.code}
              onChange={(e) => setNova({ ...nova, code: e.target.value })} placeholder="6750" />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">Descrição</span>
            <input className="input w-full" value={nova.description}
              onChange={(e) => setNova({ ...nova, description: e.target.value })} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">Natureza</span>
            <select className="input w-full text-[13px]" value={nova.type}
              onChange={(e) => setNova({ ...nova, type: e.target.value })}>
              {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}
            </select>
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">Rubrica do relatório</span>
            <select className="input w-full text-[13px]" value={nova.report_group}
              onChange={(e) => setNova({ ...nova, report_group: e.target.value })}>
              {GRUPOS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <button className="btn-primary h-10 px-5 text-sm" disabled={!nova.code.trim()} onClick={criar}>
            Criar
          </button>
        </div>
        {/*
          A rubrica é o que manda no relatório, não o código: `reports.ts`
          agrupa por `report_group` e nunca olha para o número. Dizer isto aqui
          evita a pergunta "por que a minha conta nova não aparece no DRE".
        */}
        <p className="mt-2 text-xs text-muted">
          A <b>rubrica</b> é o que decide onde a conta aparece no balanço e no DRE — o código não.
        </p>
        {erro && <p className="mt-2 text-sm text-danger">{erro}</p>}
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="font-display text-lg font-semibold">
            {contas.length} conta(s)
          </h2>
          <input className="input h-9 w-64 text-[13px]" placeholder="procurar código ou nome…"
            value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 text-left font-medium">Código</th>
                <th className="px-4 py-2 text-left font-medium">Descrição</th>
                <th className="px-4 py-2 text-left font-medium">Natureza</th>
                <th className="px-4 py-2 text-left font-medium">Rubrica</th>
                <th className="px-4 py-2 text-right font-medium">Ativa</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => (
                <tr key={c.id} className={`border-b border-line/50 ${c.active ? "" : "opacity-45"}`}>
                  <td className="px-4 py-2 font-mono">{c.code}</td>
                  <td className="px-4 py-2">{c.description}</td>
                  <td className="px-4 py-2 text-muted">{NOME_TIPO[c.type ?? ""] ?? c.type ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-[11.5px] text-muted">{c.report_group ?? "—"}</td>
                  <td className="px-4 py-2 text-right">
                    <button className="btn-ghost h-7 px-2 text-[11px]" onClick={() => alternarAtiva(c)}>
                      {c.active ? "desativar" : "ativar"}
                    </button>
                  </td>
                </tr>
              ))}
              {!carregando && filtradas.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">Nada encontrado.</td></tr>
              )}
              {carregando && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
