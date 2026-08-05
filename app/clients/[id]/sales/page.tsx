"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import type { Client, SalesEntry } from "@/lib/types";

function normDate(v: any): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) { let [, d, mo, y] = m; if (y.length === 2) y = "20" + y; return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`; }
  return s;
}
function cleanNum(s: string): string {
  return String(s ?? "").replace(/[^0-9.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v.replace(",", ".")) || 0);

type Draft = { entry_date: string; doc_number: string; customer: string; net: string; rate: string };
const blank = (): Draft => ({ entry_date: "", doc_number: "", customer: "", net: "", rate: "23" });
const vatOf = (d: Draft) => {
  const net = numOrNull(d.net), rate = numOrNull(d.rate);
  return net != null && rate != null ? (net * rate) / 100 : 0;
};
const grossOf = (d: Draft) => (numOrNull(d.net) ?? 0) + vatOf(d);

export default function SalesEntryPage({ params }: { params: { id: string } }) {
  const [client, setClient] = useState<Client | null>(null);
  const [sales, setSales] = useState<SalesEntry[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>(Array.from({ length: 5 }, blank));
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  function parseRows(aoa: any[][]): Draft[] {
    if (!aoa.length) return [];
    const norm = (s: any) => String(s ?? "").toLowerCase().trim();
    const header = (aoa[0] || []).map(norm);
    const find = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
    const hdrKeywords = ["date", "data", "net", "líquido", "liquido", "amount", "valor", "vat", "iva", "rate", "aliquota", "alíquota", "customer", "cliente", "doc", "invoice", "ref", "taxa", "%"];
    const hasHeader = header.some((h) => hdrKeywords.some((n) => h.includes(n)));
    const idx = hasHeader ? {
      date: find("date", "data"),
      doc: find("doc", "invoice", "fatura", "ref", "number", "nº", "no"),
      customer: find("customer", "cliente", "client", "nome", "name"),
      net: find("net", "líquido", "liquido", "amount", "valor", "subtotal", "base"),
      rate: find("rate", "aliquota", "alíquota", "taxa", "vat %", "vat%", "%"),
      vat: find("vat amount", "iva", "imposto", "vat €", "vat value", "tax"),
    } : null;
    const rows = hasHeader ? aoa.slice(1) : aoa;
    const out: Draft[] = [];
    for (const r of rows) {
      if (!r || r.every((c: any) => String(c ?? "").trim() === "")) continue;
      let entry_date = "", doc = "", customer = "", net = "", rate = "23";
      if (idx) {
        const g = (i: number) => (i >= 0 ? r[i] : "");
        entry_date = normDate(g(idx.date));
        doc = String(g(idx.doc) ?? "").trim();
        customer = String(g(idx.customer) ?? "").trim();
        net = cleanNum(String(g(idx.net) ?? ""));
        const rr = cleanNum(String(g(idx.rate) ?? "")); if (rr) rate = rr;
        const vat = cleanNum(String(g(idx.vat) ?? ""));
        if (!net && vat && rate) { const v = parseFloat(vat), rt = parseFloat(rate); if (v && rt) net = (v / rt * 100).toFixed(2); }
      } else {
        const p = r.map((x: any) => String(x ?? "").trim());
        if (p.length >= 5) { entry_date = normDate(p[0]); doc = p[1]; customer = p[2]; net = cleanNum(p[3]); rate = cleanNum(p[4]) || "23"; }
        else if (p.length >= 3) { entry_date = normDate(p[0]); net = cleanNum(p[1]); rate = cleanNum(p[2]) || "23"; }
        else if (p.length === 2) { entry_date = normDate(p[0]); net = cleanNum(p[1]); }
      }
      if (entry_date || net) out.push({ entry_date, doc_number: doc, customer, net, rate });
    }
    return out;
  }

  async function onFile(file: File) {
    setImporting(true); setMsg(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let aoa: any[][] = [];
      if (ext === "xlsx" || ext === "xls") {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
      } else {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        const first = lines[0] || "";
        const delim = first.includes(";") ? ";" : first.includes("\t") ? "\t" : ",";
        aoa = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "")));
      }
      const parsed = parseRows(aoa);
      if (!parsed.length) { setMsg("No rows recognised in the file. Check it has date and amount columns."); return; }
      setDrafts((prev) => [...prev.filter((d) => d.entry_date || d.net), ...parsed]);
      setMsg(`${parsed.length} rows loaded from ${file.name}. Review the grid and click Save sales.`);
    } catch (e: any) {
      setMsg("Could not read the file: " + (e?.message || "unknown error"));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
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
          <h1 className="font-display text-xl font-semibold tracking-tight">Sales entry (VAT on sales · T1)</h1>
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
                <th className="px-2 py-2 font-medium text-right">Gross €</th>
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
                  <td className="px-2 py-1.5 text-right tnum font-medium">{money(grossOf(d))}</td>
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

      {/* Import file */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Import file (Excel / CSV / TXT / statement)</h2>
            <p className="mt-1 text-sm text-muted">
              Upload a sales file or bank statement. Columns are auto-detected (date, doc, customer, net, rate, VAT).
              Rows load into the grid above for review before saving.
            </p>
          </div>
          <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? "Reading…" : "Choose file"}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden"
            onChange={(e) => e.target.files && e.target.files[0] && onFile(e.target.files[0])} />
        </div>
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
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Doc</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium text-right">Net €</th>
                <th className="px-4 py-3 font-medium text-right">VAT %</th>
                <th className="px-4 py-3 font-medium text-right">VAT €</th>
                <th className="px-4 py-3 font-medium text-right">Gross €</th>
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
                  <td className="px-4 py-2 text-right tnum font-semibold">{money((s.net_amount || 0) + (s.vat_amount || 0))}</td>
                  <td className="px-4 py-2 text-center"><button className="btn-ghost h-8 px-3 text-xs text-danger" onClick={() => remove(s.id)}>Delete</button></td>
                </tr>
              ))}
              {!sales.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">No sales recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
