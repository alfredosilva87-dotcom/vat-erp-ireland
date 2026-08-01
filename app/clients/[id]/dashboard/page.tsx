"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import LineChart from "@/components/LineChart";
import DonutChart from "@/components/DonutChart";

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
};

const money = (n: number) =>
  n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ClientDashboard({ params }: { params: { id: string } }) {
  const [d, setD] = useState<Data | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/clients/${params.id}/dashboard?year=${year}`)
      .then((r) => r.json())
      .then((data) => setD(data.error ? null : data))
      .finally(() => setLoading(false));
  }, [params.id, year]);

  const yearOptions = Array.from(new Set([year + 1, year, year - 1, year - 2])).sort((a, b) => b - a);

  if (loading && !d) return <p className="text-muted">Loading…</p>;
  if (!d) return <p className="text-muted">Could not load the dashboard.</p>;

  const { kpis, series, vatByMonth, rates, upcoming } = d;

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
          <h2 className="font-display text-xl font-semibold tracking-tight">Financial overview</h2>
          <p className="text-sm text-muted">
            Fills in automatically from posted sales (T1) and purchase invoices (T2).
          </p>
        </div>
        <select className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Faturamento (T1)" value={money(kpis.salesGross)}
          sub={`${kpis.salesCount} venda(s) · VAT € ${money(kpis.salesVat)}`}
          tone="brand" icon={<IconTrend />}
        />
        <Kpi
          label="Compras (T2)" value={money(kpis.purchaseGross)}
          sub={`${kpis.invoiceCount} nota(s) processada(s)`}
          tone="violet" icon={<IconCart />}
        />
        <Kpi
          label="VAT a pagar (T3)" value={money(kpis.vatPayable)}
          sub={kpis.vatPayable >= 0 ? "A recolher à Revenue" : "A recuperar da Revenue"}
          tone={kpis.vatPayable >= 0 ? "danger" : "success"} icon={<IconReceipt />}
        />
        <Kpi
          label="Crédito de entrada" value={money(kpis.inputCredit)}
          sub="VAT recuperável já aprovado" tone="success" icon={<IconCredit />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Sales vs purchases */}
        <section className="card p-5 xl:col-span-2">
          <h3 className="font-display text-lg font-semibold">Faturamento × Compras</h3>
          <p className="mb-2 text-sm text-muted">Vendas (T1) e compras (T2) por mês, valores brutos.</p>
          <LineChart
            data={series.map((s) => ({ label: s.month, a: s.sales, b: s.gross }))}
            aLabel="Vendas (T1)" bLabel="Compras (T2)"
          />
        </section>

        {/* Upcoming obligations */}
        <section className="card flex flex-col p-5">
          <h3 className="font-display text-lg font-semibold">Obrigações próximas</h3>
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
                  {o.state === "overdue" ? "Vencido" : o.state === "soon" ? "Em breve" : "Pendente"}
                </span>
              </li>
            ))}
            {!upcoming.length && (
              <li className="py-6 text-center text-sm text-muted">Nenhuma obrigação em aberto para {d.year}.</li>
            )}
          </ul>
          <Link href={`/clients/${params.id}/obligations`} className="btn-primary mt-3 h-9 text-xs">
            Ver todas as obrigações →
          </Link>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* VAT per month */}
        <section className="card p-5 xl:col-span-2">
          <h3 className="font-display text-lg font-semibold">VAT por período</h3>
          <p className="mb-3 text-sm text-muted">Posição líquida por mês (T1 − T2). Acima de zero = a recolher.</p>
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
          <h3 className="font-display text-lg font-semibold">Distribuição de faturamento</h3>
          <p className="mb-3 text-sm text-muted">Vendas líquidas por alíquota.</p>
          <DonutChart
            data={donut}
            total={rates.sales.reduce((a, r) => a + r.net, 0)}
            totalLabel="Vendas líquidas"
          />
        </section>
      </div>

      {/* VAT rate summary */}
      <section className="card overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="font-display text-lg font-semibold">Resumo por taxa de VAT</h3>
          <p className="text-sm text-muted">
            O que foi cobrado nas vendas contra o crédito tomado nas compras, por alíquota.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Taxa</th>
                <th className="px-4 py-3 font-medium text-right">Vendas líq. €</th>
                <th className="px-4 py-3 font-medium text-right">VAT vendas (T1) €</th>
                <th className="px-4 py-3 font-medium text-right">Compras líq. €</th>
                <th className="px-4 py-3 font-medium text-right">Crédito (T2) €</th>
                <th className="px-4 py-3 font-medium text-right">Líquido (T3) €</th>
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
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">Sem lançamentos em {d.year}.</td></tr>
              )}
            </tbody>
            {rateRows.length > 0 && (
              <tfoot>
                <tr className="bg-surface-2/60 font-semibold">
                  <td className="px-5 py-3">Total</td>
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

      {/* Quick actions */}
      <section className="card p-5">
        <h3 className="font-display text-lg font-semibold">Ações rápidas</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Action href="/analyze" title="Nova compra" desc="Importar notas (T2)" />
          <Action href={`/clients/${params.id}/sales`} title="Nova venda" desc="Lançar faturamento (T1)" />
          <Action href={`/clients/${params.id}/vat`} title="Relatório VAT" desc="Detalhe por alíquota" />
          <Action href={`/api/clients/${params.id}/export.xlsx?year=${d.year}`} title="Exportar Excel" desc="Relatório completo" external />
        </div>
      </section>
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

function Action({ href, title, desc, external }: { href: string; title: string; desc: string; external?: boolean }) {
  const inner = (
    <>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted">{desc}</div>
    </>
  );
  const cls = "rounded-xl border border-line bg-surface-2/50 p-3 transition-colors hover:border-brand/50";
  return external ? <a className={cls} href={href}>{inner}</a> : <Link className={cls} href={href}>{inner}</Link>;
}

const S = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const wrap = (c: React.ReactNode) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">{c}</svg>;
function IconTrend() { return wrap(<><path d="M3 17l6-6 4 4 7-7" {...S} /><path d="M20 8v5h-5" {...S} /></>); }
function IconCart() { return wrap(<><circle cx="9" cy="20" r="1.4" {...S} /><circle cx="18" cy="20" r="1.4" {...S} /><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.55L21 8H6" {...S} /></>); }
function IconReceipt() { return wrap(<><path d="M5 3v18l2.5-1.5L10 21l2-1.5L14 21l2.5-1.5L19 21V3z" {...S} /><path d="M9 8h6M9 12h6" {...S} /></>); }
function IconCredit() { return wrap(<><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" {...S} /><path d="M2.5 10h19" {...S} /></>); }
