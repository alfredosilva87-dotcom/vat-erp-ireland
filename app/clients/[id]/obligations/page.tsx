"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClientObligation } from "@/lib/types";

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: string): number | null => (v.trim() === "" ? null : Number(v.replace(",", ".")) || 0);

export default function Obligations({ params }: { params: { id: string } }) {
  const [obligations, setObligations] = useState<ClientObligation[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    const d = await (await fetch(
      `/api/clients/${params.id}/obligations?year=${year}${refresh ? "&refresh=1" : ""}`
    )).json();
    setObligations(d.obligations || []);
  }, [params.id, year]);

  useEffect(() => { load(); }, [load]);

  async function patchObl(id: string, patch: Partial<ClientObligation>) {
    setObligations((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    const d = await (await fetch(`/api/obligations/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    })).json();
    if (d.obligation) setObligations((prev) => prev.map((o) => (o.id === id ? d.obligation : o)));
  }

  async function refresh() {
    setBusy(true);
    await load(true);
    setBusy(false);
  }

  const yearOptions = Array.from(new Set([year + 1, year, year - 1, year - 2])).sort((a, b) => b - a);

  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 p-5">
          <div>
            <h2 className="font-display text-xl font-semibold">Tax obligations {year}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Bi-monthly VAT3 returns (due the 23rd of the following month) and the annual RTD.
              <strong className="text-ink"> T2</strong> (VAT on purchases) is auto-filled from this
              client&apos;s invoices; enter <strong className="text-ink">T1</strong> (VAT on sales)
              to get <strong className="text-ink">T3</strong>, the net position.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className="btn-ghost" onClick={refresh} disabled={busy}>
              {busy ? "Refreshing…" : "Refresh from invoices"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Return</th>
                <th className="px-3 py-3 font-medium">Period</th>
                <th className="px-3 py-3 font-medium">Due</th>
                <th className="px-3 py-3 font-medium text-right">T1 · VAT sales</th>
                <th className="px-3 py-3 font-medium text-right">T2 · VAT purchases</th>
                <th className="px-3 py-3 font-medium text-right">T3 · Net</th>
                <th className="px-3 py-3 font-medium text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {obligations.map((o) => {
                const net = (o.vat_on_sales || 0) - (o.vat_on_purchases || 0);
                const overdue = o.status === "open" && o.due_date < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={o.id} className="border-b border-line/70 align-middle">
                    <td className="px-5 py-2 font-medium">{o.kind}</td>
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
              {!obligations.length && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">No obligations generated for {year} yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted">
        T3 &gt; 0 = payable to Revenue; T3 &lt; 0 = repayable. The RTD is informational (no payment).
      </p>
    </div>
  );
}
