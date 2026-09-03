"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";

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

/*
 * As naturezas vão pela chave de tradução, não pelo rótulo cravado.
 * O VALOR (`asset`, `liability`…) fica em inglês e é o que se grava — é
 * identificador, e um identificador que muda com a língua de quem cadastrou é
 * um bug à espera de acontecer.
 */
const TIPOS = [
  { v: "asset", k: "chart.typeAsset" }, { v: "liability", k: "chart.typeLiability" },
  { v: "equity", k: "chart.typeEquity" }, { v: "revenue", k: "chart.typeRevenue" },
  { v: "expense", k: "chart.typeExpense" },
] as const;

const GRUPOS = [
  "fixed_assets_tangible", "fixed_assets_intangible", "stocks", "debtors", "cash",
  "creditors_within_1y", "creditors_after_1y", "provisions", "share_capital",
  "reserves", "profit_loss_account", "turnover", "cost_of_sales",
  "other_operating_income", "distribution_costs", "administrative_expenses",
  "interest_and_similar", "tax_on_profit",
];

/** Do valor gravado para a chave de tradução. */
const CHAVE_TIPO: Record<string, string> = Object.fromEntries(TIPOS.map((x) => [x.v, x.k]));

export default function ChartOfAccounts() {
  const { t } = useT();
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
    if (!r.ok) { setErro(d.error || t("common.saveFailed")); return; }
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
        <h1 className="font-display text-2xl font-semibold tracking-tight">{t("chart.title")}</h1>
        <p className="mt-1 text-muted">
          {t("chart.subtitle")}
        </p>
      </div>

      {/*
        O aviso é curto e fica no topo porque a confusão que ele evita é cara:
        alguém a pensar que está a arrumar o plano de um cliente e a mexer nos
        trinta e cinco.
      */}
      <div className="card border-l-4 border-l-brand p-4 text-sm">
        {t("chart.clientOwnHint")}
      </div>

      <section className="card p-5">
        <h2 className="font-display text-lg font-semibold">{t("chart.newAccount")}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[110px_minmax(0,1fr)_150px_minmax(0,1fr)_auto] sm:items-end">
          <label className="flex flex-col leading-tight">
            <span className="label">{t("chart.code")}</span>
            <input className="input w-full font-mono text-[13px]" value={nova.code}
              onChange={(e) => setNova({ ...nova, code: e.target.value })} placeholder="6750" />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">{t("chart.description")}</span>
            <input className="input w-full" value={nova.description}
              onChange={(e) => setNova({ ...nova, description: e.target.value })} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">{t("chart.type")}</span>
            <select className="input w-full text-[13px]" value={nova.type}
              onChange={(e) => setNova({ ...nova, type: e.target.value })}>
              {TIPOS.map((x) => <option key={x.v} value={x.v}>{t(x.k)}</option>)}
            </select>
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">{t("chart.reportGroup")}</span>
            <select className="input w-full text-[13px]" value={nova.report_group}
              onChange={(e) => setNova({ ...nova, report_group: e.target.value })}>
              {GRUPOS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <button className="btn-primary h-10 px-5 text-sm" disabled={!nova.code.trim()} onClick={criar}>
            {t("common.create")}
          </button>
        </div>
        {/*
          A rubrica é o que manda no relatório, não o código: `reports.ts`
          agrupa por `report_group` e nunca olha para o número. Dizer isto aqui
          evita a pergunta "por que a minha conta nova não aparece no DRE".
        */}
        <p className="mt-2 text-xs text-muted">
          {t("chart.reportGroupHint")}
        </p>
        {erro && <p className="mt-2 text-sm text-danger">{erro}</p>}
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="font-display text-lg font-semibold">
            {t("chart.count", { n: String(contas.length) })}
          </h2>
          <input className="input h-9 w-full text-[13px] sm:w-64" placeholder={t("chart.searchPlaceholder")}
            value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 text-left font-medium">{t("chart.code")}</th>
                <th className="px-4 py-2 text-left font-medium">{t("chart.description")}</th>
                <th className="px-4 py-2 text-left font-medium">{t("chart.type")}</th>
                <th className="px-4 py-2 text-left font-medium">{t("chart.group")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("chart.active")}</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => (
                <tr key={c.id} className={`border-b border-line/50 ${c.active ? "" : "opacity-45"}`}>
                  <td className="px-4 py-2 font-mono">{c.code}</td>
                  <td className="px-4 py-2">{c.description}</td>
                  <td className="px-4 py-2 text-muted">{CHAVE_TIPO[c.type ?? ""] ? t(CHAVE_TIPO[c.type ?? ""] as any) : (c.type ?? "—")}</td>
                  <td className="px-4 py-2 font-mono text-[11.5px] text-muted">{c.report_group ?? "—"}</td>
                  <td className="px-4 py-2 text-right">
                    <button className="btn-ghost h-7 px-2 text-[11px]" onClick={() => alternarAtiva(c)}>
                      {c.active ? t("chart.deactivate") : t("chart.activate")}
                    </button>
                  </td>
                </tr>
              ))}
              {!carregando && filtradas.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">{t("common.nothingFound")}</td></tr>
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
