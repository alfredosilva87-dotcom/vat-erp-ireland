"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import LineChart from "@/components/LineChart";
import DonutChart from "@/components/DonutChart";
import { useT } from "@/lib/i18n";
import { getExercise, defaultExercise, EXERCISE_EVENT } from "@/lib/exercise";
import { ORIGINS } from "@/lib/origin";
import type { StoredInvoice } from "@/lib/types";
import AgingPanel from "@/components/financial/AgingPanel";

type Kpis = {
  salesGross: number; salesVat: number; purchaseGross: number;
  inputCredit: number; vatPayable: number; invoiceCount: number; salesCount: number;
};
type SeriesPoint = { month: string; gross: number; credit: number; sales: number; salesVat: number; count: number };
type RateGroup = { rate: number; net: number; vat: number; credit?: number; count: number };
type Upcoming = { id: string; kind: string; period_label: string; due_date: string; state: "overdue" | "soon" | "pending" };
type Data = {
  year: number; kpis: Kpis; series: SeriesPoint[];
  vatByMonth: { month: string; payable: number }[];
  rates: { purchases: RateGroup[]; sales: RateGroup[] };
  upcoming: Upcoming[];
  /** Quantas notas do ano entraram por cada porta. Ver lib/origin.ts. */
  bySource?: Record<string, number>;
};

const money = (n: number) =>
  n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ClientDashboard({ params }: { params: { id: string } }) {
  const { t } = useT();
  const [d, setD] = useState<Data | null>(null);
  const [recent, setRecent] = useState<StoredInvoice[]>([]);
  /*
   * O ano vem do EXERCÍCIO da barra do topo, não de um seletor só desta tela.
   * Dois seletores de ano na mesma janela é a receita para conferir um
   * período olhando o número de outro.
   */
  const [year, setYear] = useState(defaultExercise());
  useEffect(() => {
    setYear(getExercise());
    const onYear = () => setYear(getExercise());
    window.addEventListener(EXERCISE_EVENT, onYear);
    return () => window.removeEventListener(EXERCISE_EVENT, onYear);
  }, []);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/clients/${params.id}/dashboard?year=${year}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setD(data.error ? null : data))
      .finally(() => setLoading(false));
  }, [params.id, year]);

  useEffect(() => {
    fetch(`/api/invoices?client=${params.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setRecent(data.invoices || []));
  }, [params.id]);


  if (loading && !d) return <p className="text-muted">{t("common.loading")}</p>;
  if (!d) return <p className="text-muted">Could not load the dashboard.</p>;

  const { kpis, series, vatByMonth, rates, upcoming, bySource } = d;

  // One row per VAT rate present on either side, so the table reads like a
  // VAT3 working paper: what we charged (T1) vs what we paid (T2).
  const allRates = Array.from(
    new Set([...rates.sales.map((r) => r.rate), ...rates.purchases.map((r) => r.rate)])
  ).sort((a, b) => b - a);
  const rateRows = allRates.map((rate) => {
    const s = rates.sales.find((x) => x.rate === rate);
    const p = rates.purchases.find((x) => x.rate === rate);
    return {
      rate,
      salesNet: s?.net ?? 0, salesVat: s?.vat ?? 0,
      purchaseNet: p?.net ?? 0, purchaseCredit: p?.credit ?? 0,
      net: (s?.vat ?? 0) - (p?.credit ?? 0),
    };
  });

  const donut = rates.sales.map((r) => ({ label: `${r.rate}% · vendas`, value: r.net }));
  const maxVat = Math.max(1, ...vatByMonth.map((m) => Math.abs(m.payable)));

  return (
    <div className="space-y-5">
      {/* Period picker */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">{t("client.financialOverview")}</h2>
          <p className="text-sm text-muted">
            {t("client.financialSubtitle")}
          </p>
        </div>
        <span className="text-sm text-muted">{t("client.exerciseHint")} <b className="text-ink tnum">{year}</b></span>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label={t("dash.revenueT1")} value={money(kpis.salesGross)}
          sub={`${kpis.salesCount} ${t("client.salesCount")} · VAT € ${money(kpis.salesVat)}`}
          tone="brand" icon={<IconTrend />}
        />
        <Kpi
          label={t("dash.purchasesT2")} value={money(kpis.purchaseGross)}
          sub={`${kpis.invoiceCount} ${t("client.invoiceCount")}`}
          tone="violet" icon={<IconCart />}
        />
        <Kpi
          label={t("dash.vatPayableT3")} value={money(kpis.vatPayable)}
          sub={kpis.vatPayable >= 0 ? t("client.toRevenue") : t("client.fromRevenue")}
          tone={kpis.vatPayable >= 0 ? "danger" : "success"} icon={<IconReceipt />}
        />
        <Kpi
          label={t("dash.inputCredit")} value={money(kpis.inputCredit)}
          sub={t("client.creditApproved")} tone="success" icon={<IconCredit />}
        />
      </div>

      {/*
        Por onde as notas entraram.
        Responde "a entrada automática está valendo a pena?" — a pergunta que
        vem depois de dar o link de telefone ao cliente e o endereço de e-mail
        ao fornecedor. Só aparece quando há nota no ano: uma fileira de zeros
        num cliente novo não informa nada e ainda ocupa o topo do painel.
      */}
      {/* Dinheiro a entrar e a sair — ver components/financial/AgingPanel.tsx.
          O painel mostrava imposto e faturação e não mostrava dinheiro. */}
      <AgingPanel clientId={params.id} />

      {bySource && Object.values(bySource).some((n) => n > 0) && (
        <section className="card p-5">
          <h3 className="font-display text-lg font-semibold">{t("dash.originTitle")}</h3>
          <p className="text-sm text-muted">{t("dash.originSub")}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {ORIGINS.map((o) => (
              <OriginStat key={o.key} label={t(o.labelKey)} count={bySource[o.key] || 0} highlight={o.key === "phone"} />
            ))}
            {bySource.unknown > 0 && (
              <OriginStat label={t("origin.unknown")} count={bySource.unknown} highlight={false} />
            )}
          </div>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Sales vs purchases */}
        <section className="card p-5 xl:col-span-2">
          <h3 className="font-display text-lg font-semibold">{t("client.revenueVsPurchases")}</h3>
          <p className="mb-2 text-sm text-muted">{t("client.revenueVsPurchasesSub")}</p>
          <LineChart
            data={series.map((s) => ({ label: s.month, a: s.sales, b: s.gross }))}
            aLabel={t("dash.revenueT1")} bLabel={t("dash.purchasesT2")}
          />
        </section>

        {/* Upcoming obligations */}
        <section className="card flex flex-col p-5">
          <h3 className="font-display text-lg font-semibold">{t("client.upcoming")}</h3>
          <ul className="mt-3 flex-1 space-y-2">
            {upcoming.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 border-b border-line/60 pb-2 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{o.kind} {o.period_label}</div>
                  <div className="text-xs tnum text-muted">{o.due_date}</div>
                </div>
                <span className={
                  o.state === "overdue" ? "chip-danger" : o.state === "soon" ? "chip-warn" : "chip bg-surface-2 text-muted"
                }>
                  {o.state === "overdue" ? t("client.overdue") : o.state === "soon" ? t("client.soon") : t("client.pending")}
                </span>
              </li>
            ))}
            {!upcoming.length && (
              <li className="py-6 text-center text-sm text-muted">{t("client.noOpenObligations")} {d.year}.</li>
            )}
          </ul>
          <Link href={`/clients/${params.id}/obligations`} className="btn-primary mt-3 h-9 text-xs">
            {t("client.seeAllObligations")}
          </Link>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* VAT per month */}
        <section className="card p-5 xl:col-span-2">
          <h3 className="font-display text-lg font-semibold">{t("client.vatByPeriod")}</h3>
          <p className="mb-3 text-sm text-muted">{t("client.vatByPeriodSub")}</p>
          <div className="flex h-40 items-end gap-1.5">
            {vatByMonth.map((m) => {
              const h = (Math.abs(m.payable) / maxVat) * 100;
              return (
                <div key={m.month} className="group flex flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[10px] tnum text-muted opacity-0 transition-opacity group-hover:opacity-100">
                    {money(m.payable)}
                  </span>
                  <div
                    className={`w-full rounded-md ${m.payable >= 0 ? "bg-gradient-to-t from-brand-600 to-brand-400" : "bg-success/70"}`}
                    style={{ height: `${Math.max(h, m.payable === 0 ? 0 : 3)}%` }}
                    title={`${m.month}: € ${money(m.payable)}`}
                  />
                  <span className="text-[10px] text-muted">{m.month}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Sales split */}
        <section className="card p-5">
          <h3 className="font-display text-lg font-semibold">{t("client.revenueSplit")}</h3>
          <p className="mb-3 text-sm text-muted">{t("client.revenueSplitSub")}</p>
          <DonutChart
            data={donut}
            total={rates.sales.reduce((a, r) => a + r.net, 0)}
            totalLabel={t("client.netSales")}
          />
        </section>
      </div>

      {/* VAT rate summary */}
      <section className="card overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="font-display text-lg font-semibold">{t("client.rateSummary")}</h3>
          <p className="text-sm text-muted">
            {t("client.rateSummarySub")}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Rate</th>
                <th className="px-4 py-3 font-medium text-right">Net sales €</th>
                <th className="px-4 py-3 font-medium text-right">VAT sales (T1) €</th>
                <th className="px-4 py-3 font-medium text-right">Net purchases €</th>
                <th className="px-4 py-3 font-medium text-right">Credit (T2) €</th>
                <th className="px-4 py-3 font-medium text-right">Net (T3) €</th>
              </tr>
            </thead>
            <tbody>
              {rateRows.map((r) => (
                <tr key={r.rate} className="border-b border-line/70">
                  <td className="px-5 py-2.5 font-medium">{r.rate}%</td>
                  <td className="px-4 py-2.5 text-right tnum">{money(r.salesNet)}</td>
                  <td className="px-4 py-2.5 text-right tnum">{money(r.salesVat)}</td>
                  <td className="px-4 py-2.5 text-right tnum">{money(r.purchaseNet)}</td>
                  <td className="px-4 py-2.5 text-right tnum text-brand-700">{money(r.purchaseCredit)}</td>
                  <td className={`px-4 py-2.5 text-right tnum font-semibold ${r.net > 0 ? "text-danger" : "text-success"}`}>
                    {money(r.net)}
                  </td>
                </tr>
              ))}
              {!rateRows.length && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">{t("client.noData")} {d.year}.</td></tr>
              )}
            </tbody>
            {rateRows.length > 0 && (
              <tfoot>
                <tr className="bg-surface-2/60 font-semibold">
                  <td className="px-5 py-3">{t("common.total")}</td>
                  <td className="px-4 py-3 text-right tnum">{money(rateRows.reduce((a, r) => a + r.salesNet, 0))}</td>
                  <td className="px-4 py-3 text-right tnum">{money(kpis.salesVat)}</td>
                  <td className="px-4 py-3 text-right tnum">{money(rateRows.reduce((a, r) => a + r.purchaseNet, 0))}</td>
                  <td className="px-4 py-3 text-right tnum text-brand-700">{money(kpis.inputCredit)}</td>
                  <td className={`px-4 py-3 text-right tnum ${kpis.vatPayable > 0 ? "text-danger" : "text-success"}`}>
                    {money(kpis.vatPayable)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/*
        As notas recentes vieram da antiga "Visão geral", que virou parte desta
        tela. O gráfico que ela também tinha ficou de fora: era o mesmo dado do
        "Faturamento × Compras" acima, em outro desenho — duas telas
        respondendo à mesma pergunta é o que fazia a pessoa abrir as duas.
      */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <h3 className="font-display text-lg font-semibold">{t("client.recentInvoices")}</h3>
          <Link href={`/records?client=${params.id}`} className="text-sm text-brand-700">
            {t("client.openDatabase")}
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">{t("analyze.supplier")}</th>
                <th className="px-4 py-3 font-medium">{t("common.date")}</th>
                <th className="px-4 py-3 font-medium text-right">{t("dash.grossSpend")}</th>
                <th className="px-4 py-3 font-medium text-right">{t("dash.credit")}</th>
                <th className="px-4 py-3 font-medium text-center">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {recent.slice(0, 10).map((inv) => (
                <tr key={inv.id} className="border-b border-line/70">
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{inv.supplier_name || "—"}</span>
                      {inv.needs_review && (
                        <span className="chip-warn" title={inv.review_notes?.join("; ")}>{t("records.review")}</span>
                      )}
                      {inv.reviewed_at && <span className="chip-ok">conferida</span>}
                    </div>
                    {inv.store_name && <div className="text-xs text-muted">{inv.store_name}</div>}
                  </td>
                  <td className="px-4 py-3 tnum">{inv.invoice_date || "—"}</td>
                  <td className="px-4 py-3 text-right tnum">{money(inv.total_gross ?? 0)}</td>
                  <td className="px-4 py-3 text-right tnum font-semibold text-brand-700">{money(inv.total_credit ?? 0)}</td>
                  <td className="px-4 py-3 text-center">
                    <Link className="btn-ghost h-8 px-3 text-xs" href={`/invoice/${inv.id}?from=/clients/${params.id}/dashboard`}>
                      {t("common.open")}
                    </Link>
                  </td>
                </tr>
              ))}
              {!recent.length && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">{t("client.noInvoices")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/**
 * Uma porta de entrada e quantas notas vieram por ela.
 *
 * Zero é mostrado, não escondido: "nenhuma nota chegou pelo telefone" é
 * exatamente o que o escritório precisa ver depois de mandar o link — some a
 * linha e a tela vira "está tudo certo" quando talvez o link nem esteja
 * funcionando.
 */
function OriginStat({ label, count, highlight }: { label: string; count: number; highlight: boolean }) {
  return (
    <div className={`min-w-[128px] flex-1 rounded-xl border px-4 py-3 ${
      highlight && count > 0 ? "border-brand/40 bg-brand-50" : "border-line bg-surface-2/40"
    }`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold tnum ${count > 0 ? "" : "text-muted"}`}>{count}</div>
    </div>
  );
}

function Kpi({ label, value, sub, tone, icon }: {
  label: string; value: string; sub: string;
  tone: "brand" | "violet" | "success" | "danger"; icon: React.ReactNode;
}) {
  const tones = {
    brand: "bg-brand-50 text-brand-700",
    violet: "bg-violet-50 text-violet",
    success: "bg-success-50 text-success",
    danger: "bg-danger-50 text-danger",
  } as const;
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
          <div className="mt-1.5 font-display text-2xl font-semibold tnum">€ {value}</div>
        </div>
        <span className={`badge-soft shrink-0 ${tones[tone]}`}>{icon}</span>
      </div>
      <div className="mt-2 text-xs text-muted">{sub}</div>
    </div>
  );
}

const S = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const wrap = (c: React.ReactNode) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">{c}</svg>;
function IconTrend() { return wrap(<><path d="M3 17l6-6 4 4 7-7" {...S} /><path d="M20 8v5h-5" {...S} /></>); }
function IconCart() { return wrap(<><circle cx="9" cy="20" r="1.4" {...S} /><circle cx="18" cy="20" r="1.4" {...S} /><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.55L21 8H6" {...S} /></>); }
function IconReceipt() { return wrap(<><path d="M5 3v18l2.5-1.5L10 21l2-1.5L14 21l2.5-1.5L19 21V3z" {...S} /><path d="M9 8h6M9 12h6" {...S} /></>); }
function IconCredit() { return wrap(<><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" {...S} /><path d="M2.5 10h19" {...S} /></>); }
