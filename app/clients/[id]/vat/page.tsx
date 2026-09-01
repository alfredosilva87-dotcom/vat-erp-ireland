"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Client } from "@/lib/types";

type RateDoc = { id: string; label: string; date: string | null; net: number; vat: number };
type RateGroup = { rate: number; net: number; vat: number; credit?: number; count: number; docs: RateDoc[] };

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BIMESTERS = [
  { label: "Full year", months: [0, 11] },
  { label: "Jan–Feb", months: [0, 1] },
  { label: "Mar–Apr", months: [2, 3] },
  { label: "May–Jun", months: [4, 5] },
  { label: "Jul–Aug", months: [6, 7] },
  { label: "Sep–Oct", months: [8, 9] },
  { label: "Nov–Dec", months: [10, 11] },
];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function VatByRate({ params }: { params: { id: string } }) {
  const [client, setClient] = useState<Client | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [bi, setBi] = useState(0);
  const [purchases, setPurchases] = useState<RateGroup[]>([]);
  const [sales, setSales] = useState<RateGroup[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const range = useCallback(() => {
    const b = BIMESTERS[bi];
    return { start: iso(new Date(Date.UTC(year, b.months[0], 1))), end: iso(new Date(Date.UTC(year, b.months[1] + 1, 0))) };
  }, [year, bi]);

  const load = useCallback(async () => {
    setLoading(true);
    const c = await (await fetch(`/api/clients/${params.id}`)).json();
    setClient(c.client || null);
    const { start, end } = range();
    const d = await (await fetch(`/api/clients/${params.id}/vat-by-rate?start=${start}&end=${end}`)).json();
    setPurchases(d.purchases || []);
    setSales(d.sales || []);
    setLoading(false);
  }, [params.id, range]);

  useEffect(() => { load(); }, [load]);

  function exportExcel() {
    // Styled workbook is built server-side — just follow the download URL.
    window.location.href = `/api/clients/${params.id}/export.xlsx?year=${year}`;
  }

  const sum = (g: RateGroup[], k: "net" | "vat") => g.reduce((a, x) => a + (x[k] || 0), 0);

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">VAT by rate</h1>
          <p className="mt-1 text-muted">Entradas e saídas agrupadas por alíquota. Clique numa linha para ver os documentos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <select className="input h-9 w-24" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[year - 2, year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="input h-9 w-44" value={bi} onChange={(e) => setBi(Number(e.target.value))}>
            {BIMESTERS.map((b, i) => <option key={b.label} value={i}>{b.label}</option>)}
          </select>
          <button className="btn-ghost" onClick={exportExcel}>Export Excel</button>
          <button className="btn-ghost" onClick={() => window.print()}>Export PDF</button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <RateTable title="Entradas (compras)" groups={purchases} open={open} setOpen={setOpen} keyPrefix="p" linkDocs backTo={`/clients/${params.id}/vat`} sum={sum} />
          <RateTable title="Saídas (vendas)" groups={sales} open={open} setOpen={setOpen} keyPrefix="s" linkDocs={false} backTo={`/clients/${params.id}/vat`} sum={sum} />
        </div>
      )}
    </div>
  );
}

function RateTable({ title, groups, open, setOpen, keyPrefix, linkDocs, backTo, sum }: {
  title: string; groups: RateGroup[]; open: Record<string, boolean>;
  setOpen: (f: (p: Record<string, boolean>) => Record<string, boolean>) => void;
  keyPrefix: string; linkDocs: boolean;
  /** Para a revisão da nota saber de que cliente ela é (mantém o menu do módulo). */
  backTo: string;
  sum: (g: RateGroup[], k: "net" | "vat") => number;
}) {
  const money2 = (n: number) => n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line bg-surface-2/60 px-4 py-3 font-medium">{title}</div>
      <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-4 py-2 font-medium">Rate</th>
            <th className="px-4 py-2 font-medium text-right">Net €</th>
            <th className="px-4 py-2 font-medium text-right">VAT €</th>
            <th className="px-4 py-2 font-medium text-right">Docs</th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">No data in this period.</td></tr>
          )}
          {groups.map((g) => {
            const k = `${keyPrefix}${g.rate}`;
            const isOpen = !!open[k];
            return (
              <Fragment key={k}>
                <tr className="cursor-pointer border-b border-line/70 hover:bg-surface-2/60" onClick={() => setOpen((p) => ({ ...p, [k]: !p[k] }))}>
                  <td className="px-4 py-2 font-medium">{isOpen ? "▾" : "▸"} {g.rate}%</td>
                  <td className="px-4 py-2 text-right tnum">{money2(g.net)}</td>
                  <td className="px-4 py-2 text-right tnum font-semibold text-brand-700">{money2(g.vat)}</td>
                  <td className="px-4 py-2 text-right tnum">{g.count}</td>
                </tr>
                {isOpen && g.docs.map((d) => (
                  <tr key={k + d.id} className="border-b border-line/50 bg-surface-2/40 text-xs">
                    <td className="px-4 py-1.5 pl-8">
                      {linkDocs ? <Link className="text-brand hover:underline" href={`/invoice/${d.id}?from=${encodeURIComponent(backTo)}`}>{d.label}</Link> : d.label}
                      {d.date ? <span className="text-muted"> · {d.date}</span> : ""}
                    </td>
                    <td className="px-4 py-1.5 text-right tnum">{money2(d.net)}</td>
                    <td className="px-4 py-1.5 text-right tnum">{money2(d.vat)}</td>
                    <td className="px-4 py-1.5 text-right">
                      {linkDocs && <a className="text-brand hover:underline" href={`/api/invoices/${d.id}/document`} target="_blank" rel="noreferrer">doc</a>}
                    </td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
          {groups.length > 0 && (
            <tr className="bg-surface-2/60 font-semibold">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right tnum">{money2(sum(groups, "net"))}</td>
              <td className="px-4 py-2 text-right tnum text-brand-700">{money2(sum(groups, "vat"))}</td>
              <td className="px-4 py-2"></td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
