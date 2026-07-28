"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Client, StoredInvoice, ClientObligation } from "@/lib/types";
import { setCurrentClient } from "@/lib/currentClient";
import { downloadClientWorkbook } from "@/lib/exportXlsx";
import MiniBars from "@/components/MiniBars";

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: string): number | null => (v.trim() === "" ? null : Number(v.replace(",", ".")) || 0);

export default function ClientDashboard({ params }: { params: { id: string } }) {
  const [client, setClient] = useState<Client | null>(null);
  const [invoices, setInvoices] = useState<StoredInvoice[]>([]);
  const [obligations, setObligations] = useState<ClientObligation[]>([]);
  const [series, setSeries] = useState<{ month: string; gross: number; credit: number; count: number }[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  const loadObligations = useCallback(async (refresh = false) => {
    const d = await (await fetch(`/api/clients/${params.id}/obligations?year=${year}${refresh ? "&refresh=1" : ""}`)).json();
    setObligations(d.obligations || []);
    setSeries(d.series || []);
  }, [params.id, year]);

  useEffect(() => {
    (async () => {
      const c = await (await fetch(`/api/clients/${params.id}`)).json();
      setClient(c.client || null);
      const inv = await (await fetch(`/api/invoices?client=${params.id}`)).json();
      setInvoices(inv.invoices || []);
      await loadObligations();
      setLoading(false);
    })();
  }, [params.id, loadObligations]);

  const totals = useMemo(() => {
    const gross = invoices.reduce((a, i) => a + (i.total_gross || 0), 0);
    const credit = invoices.reduce((a, i) => a + (i.total_credit || 0), 0);
    return { gross, credit, count: invoices.length };
  }, [invoices]);

  // increase/decrease vs previous month with data
  const trend = useMemo(() => {
    const withData = series.filter((s) => s.count > 0);
    if (withData.length < 2) return null;
    const last = withData[withData.length - 1], prev = withData[withData.length - 2];
    if (!prev.gross) return null;
    const pct = ((last.gross - prev.gross) / prev.gross) * 100;
    return { pct, up: pct >= 0, last: last.month, prev: prev.month };
  }, [series]);

  async function patchObl(id: string, patch: Partial<ClientObligation>) {
    setObligations((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    const d = await (await fetch(`/api/obligations/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    })).json();
    if (d.obligation) setObligations((prev) => prev.map((o) => (o.id === id ? d.obligation : o)));
  }

  async function exportExcel() {
    const data = await (await fetch(`/api/clients/${params.id}/export?year=${year}`)).json();
    downloadClientWorkbook(data);
  }

  if (loading) return <p className="text-muted">Loading…</p>;
  if (!client) return <p className="text-muted">Client not found. <Link href="/clients" className="text-brand">Back</Link></p>;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="rise flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/clients" className="text-sm text-brand">← Clients</Link>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{client.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
            <span className="font-mono">{client.client_code}</span>
            <span>{client.activity_label}</span>
            {client.vat_number && <span className="font-mono">VAT {client.vat_number}</span>}
            {client.tax_reg_no && <span className="font-mono">TRN {client.tax_reg_no}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => setCurrentClient({ id: client.id, name: client.name, activity_code: client.activity_code })}>
            Set as active
          </button>
          <Link href={`/clients/${params.id}/sales`} className="btn-ghost">Enter sales (T1)</Link>
          <Link href={`/clients/${params.id}/accounts`} className="btn-ghost">Chart of accounts</Link>
          <Link href={`/clients/${params.id}/branches`} className="btn-ghost">Branches</Link>
          <Link href={`/clients/${params.id}/vat`} className="btn-ghost">VAT by rate</Link>
          <Link href={`/clients/${params.id}/bright`} className="btn-ghost">Bright / BrightBooks</Link>
          <button className="btn-ghost" onClick={exportExcel}>Export Excel</button>
          <button className="btn-primary" onClick={() => window.print()}>Export PDF</button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="Invoices" value={String(totals.count)} tone="bg-brand-50 text-brand-700" />
        <Tile label="Gross spend €" value={money(totals.gross)} tone="bg-violet-50 text-violet" />
        <Tile label="Input credit €" value={money(totals.credit)} tone="bg-success-50 text-success" strong />
      </div>

      {/* Entries chart */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold">Entries by month</h2>
            <p className="mt-0.5 text-sm text-muted">
              Purchases (gross, blue) and input credit (green).
              {trend && (
                <span className={trend.up ? "text-success" : "text-danger"}>
                  {" "}{trend.up ? "▲" : "▼"} {Math.abs(trend.pct).toFixed(1)}% {trend.prev}→{trend.last}
                </span>
              )}
            </p>
          </div>
          <select className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[year + 1, year, year - 1, year - 2].filter((y, i, a) => a.indexOf(y) === i).sort((a, b) => b - a).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="mt-4">
          {series.some((s) => s.count) ? <MiniBars data={series} /> : (
            <p className="py-8 text-center text-sm text-muted">No invoices dated in {year}.</p>
          )}
        </div>
      </section>

      {/* Tax obligations */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">Tax obligations {year}</h2>
            <p className="mt-1 text-sm text-muted">
              Bi-monthly VAT3 returns (due 23rd of the following month) and the annual RTD. Input VAT
              is auto-filled from this client&apos;s invoices; enter VAT on sales to get the net.
            </p>
          </div>
          <button className="btn-ghost" onClick={() => loadObligations(true)}>Refresh from invoices</button>
        </div>
        <div className="mt-4 card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-3 font-medium">Return</th>
                  <th className="px-3 py-3 font-medium">Period</th>
                  <th className="px-3 py-3 font-medium">Due</th>
                  <th className="px-3 py-3 font-medium text-right">VAT sales (T1)</th>
                  <th className="px-3 py-3 font-medium text-right">VAT purchases (T2)</th>
                  <th className="px-3 py-3 font-medium text-right">Net</th>
                  <th className="px-3 py-3 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {obligations.map((o) => {
                  const net = (o.vat_on_sales || 0) - (o.vat_on_purchases || 0);
                  const overdue = o.status === "open" && o.due_date < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={o.id} className="border-b border-line/70 align-middle">
                      <td className="px-3 py-2 font-medium">{o.kind}</td>
                      <td className="px-3 py-2">{o.period_label}</td>
                      <td className="px-3 py-2 tnum">
                        {o.due_date}
                        {overdue && <span className="ml-1 chip-danger">overdue</span>}
                      </td>
                      <td className="px-3 py-2">
                        <input className="input h-9 w-24 text-right" defaultValue={o.vat_on_sales ?? ""}
                          disabled={o.status === "filed"}
                          onBlur={(e) => patchObl(o.id, { vat_on_sales: num(e.target.value) })} />
                      </td>
                      <td className="px-3 py-2">
                        <input className="input h-9 w-24 text-right" defaultValue={o.vat_on_purchases ?? ""}
                          disabled={o.status === "filed"}
                          onBlur={(e) => patchObl(o.id, { vat_on_purchases: num(e.target.value) })} />
                      </td>
                      <td className={`px-3 py-2 text-right tnum font-semibold ${net > 0 ? "text-danger" : "text-success"}`}>
                        {money(net)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {o.status === "filed" ? (
                          <button className="chip-ok" onClick={() => patchObl(o.id, { status: "open" })}>Filed ✓</button>
                        ) : (
                          <button className="btn-ghost h-8 px-3 text-xs" onClick={() => patchObl(o.id, { status: "filed" })}>Mark filed</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">
          Net &gt; 0 = payable to Revenue; Net &lt; 0 = repayable. The RTD is informational (no payment).
        </p>
      </section>

      {/* Recent invoices */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Invoices</h2>
          <Link href="/records" className="text-sm text-brand">Open database →</Link>
        </div>
        <div className="mt-4 card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">Gross €</th>
                  <th className="px-4 py-3 font-medium text-right">Credit €</th>
                  <th className="px-4 py-3 font-medium text-center">—</th>
                </tr>
              </thead>
              <tbody>
                {invoices.slice(0, 15).map((inv) => (
                  <tr key={inv.id} className="border-b border-line/70">
                    <td className="px-4 py-3">
                      <div className="font-medium">{inv.supplier_name || "Unknown"}</div>
                      {inv.store_name && <div className="text-xs text-muted">{inv.store_name}</div>}
                    </td>
                    <td className="px-4 py-3 tnum">{inv.invoice_date || "—"}</td>
                    <td className="px-4 py-3 text-right tnum">{money(inv.total_gross)}</td>
                    <td className="px-4 py-3 text-right tnum font-semibold text-brand-700">{money(inv.total_credit)}</td>
                    <td className="px-4 py-3 text-center">
                      <Link className="btn-ghost h-8 px-3 text-xs" href={`/invoice/${inv.id}`}>Open</Link>
                    </td>
                  </tr>
                ))}
                {!invoices.length && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No invoices for this client yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value, tone, strong }: { label: string; value: string; tone: string; strong?: boolean }) {
  return (
    <div className="card p-5">
      <div className={`badge-soft ${tone}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" /></svg>
      </div>
      <div className={`mt-4 font-display text-2xl font-semibold tnum ${strong ? "text-brand-700" : ""}`}>{value}</div>
      <div className="mt-0.5 text-sm text-muted">{label}</div>
    </div>
  );
}
