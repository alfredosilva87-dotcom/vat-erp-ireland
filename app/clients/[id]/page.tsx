"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { StoredInvoice } from "@/lib/types";
import MiniBars, { type SeriesPoint } from "@/components/MiniBars";

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ClientOverview({ params }: { params: { id: string } }) {
  const [invoices, setInvoices] = useState<StoredInvoice[]>([]);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const inv = await (await fetch(`/api/invoices?client=${params.id}`)).json();
      setInvoices(inv.invoices || []);
      setLoading(false);
    })();
  }, [params.id]);

  useEffect(() => {
    (async () => {
      const d = await (await fetch(`/api/clients/${params.id}/obligations?year=${year}`)).json();
      setSeries(d.series || []);
    })();
  }, [params.id, year]);

  // increase/decrease vs the previous month that had data
  const trend = useMemo(() => {
    const withData = series.filter((s) => s.count > 0);
    if (withData.length < 2) return null;
    const last = withData[withData.length - 1], prev = withData[withData.length - 2];
    if (!prev.gross) return null;
    const pct = ((last.gross - prev.gross) / prev.gross) * 100;
    return { pct, up: pct >= 0, last: last.month, prev: prev.month };
  }, [series]);

  const yearOptions = Array.from(new Set([year + 1, year, year - 1, year - 2])).sort((a, b) => b - a);

  return (
    <div className="space-y-6">
      {/* Purchases vs sales */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold">Entries by month</h2>
            <p className="mt-0.5 text-sm text-muted">
              Purchases in (gross), sales out, and the input credit earned.
              {trend && (
                <span className={trend.up ? "text-success" : "text-danger"}>
                  {" "}{trend.up ? "▲" : "▼"} {Math.abs(trend.pct).toFixed(1)}% {trend.prev}→{trend.last}
                </span>
              )}
            </p>
          </div>
          <select className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="mt-4">
          {series.some((s) => s.count || s.sales) ? (
            <MiniBars data={series} />
          ) : (
            <p className="py-10 text-center text-sm text-muted">No entries dated in {year}.</p>
          )}
        </div>
      </section>

      {/* Recent invoices */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="font-display text-xl font-semibold">Recent invoices</h2>
          <Link href="/records" className="text-sm text-brand-700">Open database →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium text-right">Gross €</th>
                <th className="px-4 py-3 font-medium text-right">Credit €</th>
                <th className="px-4 py-3 font-medium text-center">—</th>
              </tr>
            </thead>
            <tbody>
              {invoices.slice(0, 15).map((inv) => (
                <tr key={inv.id} className="border-b border-line/70">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{inv.supplier_name || "Unknown"}</span>
                      {inv.needs_review && (
                        <span className="chip-warn" title={inv.review_notes?.join("; ")}>Review</span>
                      )}
                    </div>
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
              {!invoices.length && !loading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">No invoices for this client yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
