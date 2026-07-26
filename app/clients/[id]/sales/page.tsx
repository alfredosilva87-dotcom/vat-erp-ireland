"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Client, SalesEntry } from "@/lib/types";

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v.replace(",", ".")) || 0);

type Draft = { entry_date: string; doc_number: string; customer: string; net: string; rate: string };
const blank = (): Draft => ({ entry_date: "", doc_number: "", customer: "", net: "", rate: "23" });
const vatOf = (d: Draft) => {
  const net = numOrNull(d.net), rate = numOrNull(d.rate);
  return net != null && rate != null ? (net * rate) / 100 : 0;
};

export default function SalesEntryPage({ params }: { params: { id: string } }) {
  const [client, setClient] = useState<Client | null>(null);
  const [sales, setSales] = useState<SalesEntry[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>(Array.from({ length: 5 }, blank));
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const c = await (await fetch(`/api/clients/${params.id}`)).json();
    setClient(c.client || null);
    const s = await (await fetch(`/api/clients/${params.id}/sales`)).json();
    setSales(s.sales || []);
  }, [params.id]);
  useEffect(() => { load(); }, [load]);

  function setDraft(i: number, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  }
  function addBlank() { setDrafts((prev) => [...prev, blank()]); }

  function importPaste() {
    // lines: date,net,rate   OR   date;doc;customer;net;rate
    const rows: Draft[] = [];
    for (const line of paste.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const p = line.split(/[;,\t]/).map((x) => x.trim());
      if (p.length >= 5) rows.push({ entry_date: p[0], doc_number: p[1], customer: p[2], net: p[3], rate: p[4] });
      else if (p.length >= 3) rows.push({ entry_date: p[0], doc_number: "", customer: "", net: p[1], rate: p[2] });
      else if (p.length === 2) rows.push({ entry_date: p[0], doc_number: "", customer: "", net: p[1], rate: "23" });
    }
    if (rows.length) { setDrafts((prev) => [...prev.filter((d) => d.entry_date || d.net), ...rows]); setPaste(""); setMsg(`${rows.length} lines parsed.`); }
  }

  const totalVat = useMemo(() => drafts.reduce((a, d) => a + (d.entry_date && d.net ? vatOf(d) : 0), 0), [drafts]);

  async function save() {
    const rows = drafts
      .filter((d) => d.entry_date && d.net)
      .map((d) => ({ entry_date: d.entry_date, doc_number: d.doc_number || null, customer: d.customer || null, net_amount: numOrNull(d.net), vat_rate: numOrNull(d.rate) }));
    if (!rows.length) { setMsg("Fill at least a date and net amount."); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${params.id}/sales`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
      const d = await res.json();
      // refresh obligations so T1 updates
      await fetch(`/api/clients/${params.id}/obligations?refresh=1`);
      setDrafts(Array.from({ length: 5 }, blank));
      setMsg(`${d.count} sales saved. VAT on sales (T1) updated in the obligations.`);
      load();
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    await fetch(`/api/sales/${id}`, { method: "DELETE" });
    await fetch(`/api/clients/${params.id}/obligations?refresh=1`);
    load();
  }

  const salesTotal = sales.reduce((a, s) => a + (s.vat_amount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/clients/${params.id}`} className="text-sm text-brand">← {client?.name || "Client"}</Link>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Sales entry (VAT on sales · T1)</h1>
          <p className="mt-1 text-muted">
            Enter emitted invoices (sales) in bulk. The VAT on sales feeds the client&apos;s bi-monthly
            VAT3 and annual RTD automatically.
          </p>
        </div>
        <span className="chip bg-brand text-white">Recorded VAT on sales € {money(salesTotal)}</span>
      </div>

      {/* Bulk entry grid */}
      <div className="card p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-2 py-2 font-medium">Date</th>
                <th className="px-2 py-2 font-medium">Doc no.</th>
                <th className="px-2 py-2 font-medium">Customer</th>
                <th className="px-2 py-2 font-medium text-right">Net €</th>
                <th className="px-2 py-2 font-medium text-right">VAT %</th>
                <th className="px-2 py-2 font-medium text-right">VAT €</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d, i) => (
                <tr key={i} className="border-b border-line/60">
                  <td className="px-2 py-1.5"><input type="date" className="input h-9" value={d.entry_date} onChange={(e) => setDraft(i, { entry_date: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><input className="input h-9 w-28" value={d.doc_number} onChange={(e) => setDraft(i, { doc_number: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><input className="input h-9" value={d.customer} onChange={(e) => setDraft(i, { customer: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><input className="input h-9 w-28 text-right" value={d.net} onChange={(e) => setDraft(i, { net: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><input className="input h-9 w-20 text-right" value={d.rate} onChange={(e) => setDraft(i, { rate: e.target.value })} /></td>
                  <td className="px-2 py-1.5 text-right tnum">{money(vatOf(d))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn-ghost" onClick={addBlank}>+ Add row</button>
          <span className="text-sm text-muted">VAT to add: <strong className="tnum">€ {money(totalVat)}</strong></span>
          <button className="btn-primary ml-auto" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save sales"}</button>
        </div>
        {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
      </div>

      {/* Paste bulk */}
      <div className="card p-5">
        <h2 className="font-display text-lg font-semibold">Paste bulk</h2>
        <p className="mt-1 text-sm text-muted">One per line: <code className="font-mono">date, net, rate</code> or <code className="font-mono">date; doc; customer; net; rate</code> (e.g. <code className="font-mono">2026-01-15, 1000, 23</code>).</p>
        <textarea className="input mt-3 h-28 py-2" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"2026-01-15, 1000, 23\n2026-02-03, 500, 13.5"} />
        <button className="btn-ghost mt-3" onClick={importPaste}>Parse into grid</button>
      </div>

      {/* Existing sales */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Doc</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium text-right">Net €</th>
                <th className="px-4 py-3 font-medium text-right">VAT %</th>
                <th className="px-4 py-3 font-medium text-right">VAT €</th>
                <th className="px-4 py-3 font-medium text-center">—</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} className="border-b border-line/70">
                  <td className="px-4 py-2 tnum">{s.entry_date}</td>
                  <td className="px-4 py-2 font-mono text-xs">{s.doc_number || "—"}</td>
                  <td className="px-4 py-2">{s.customer || "—"}</td>
                  <td className="px-4 py-2 text-right tnum">{money(s.net_amount)}</td>
                  <td className="px-4 py-2 text-right tnum">{s.vat_rate ?? "—"}</td>
                  <td className="px-4 py-2 text-right tnum font-semibold">{money(s.vat_amount)}</td>
                  <td className="px-4 py-2 text-center"><button className="btn-ghost h-8 px-3 text-xs text-danger" onClick={() => remove(s.id)}>Delete</button></td>
                </tr>
              ))}
              {!sales.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">No sales recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
