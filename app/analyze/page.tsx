"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getCurrentClient } from "@/lib/currentClient";
import type { AnalyzedItem } from "@/lib/types";

type Header = {
  supplier_name: string | null; store_name: string | null; supplier_vat: string | null;
  invoice_number: string | null; barcode: string | null; invoice_date: string | null;
  invoice_time: string | null; doc_type: string;
  total_net: number | null; total_vat: number | null; total_gross: number | null;
};
type Result = {
  filename: string; engine: string; confidence: number; base_source: string;
  ai_matched?: number; cache_matched?: number; header: Header; items: AnalyzedItem[];
};
type RowStatus = "pending" | "reading" | "read" | "error" | "saving" | "saved";
type Row = { file: File; status: RowStatus; result?: Result; error?: string; savedId?: string };

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const creditValue = (it: AnalyzedItem): number => {
  if (!it.take_credit) return 0;
  if (it.vat_amount_on_invoice != null) return it.vat_amount_on_invoice;
  if (it.net_amount != null && it.expected_vat_rate != null) return (it.net_amount * it.expected_vat_rate) / 100;
  return 0;
};
const docCredit = (r: Row) => (r.result ? r.result.items.reduce((a, i) => a + creditValue(i), 0) : 0);
const engineLabel = (e?: string) => e === "pdf-native" ? "PDF" : e === "gemini-vision" ? "AI" : e === "tesseract" ? "OCR" : "—";

export default function Analyze() {
  const [clients, setClients] = useState<{ id: string; name: string; client_code: string; activity_code: string; activity_label: string }[]>([]);
  const [clientId, setClientId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "reading" | "saving">("idle");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const activity = clients.find((c) => c.id === clientId)?.activity_code || "GENERIC";

  useEffect(() => {
    fetch("/api/clients").then((r) => r.json()).then((d) => setClients(d.clients || []));
    const cur = getCurrentClient();
    if (cur) setClientId(cur.id);
  }, []);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const accepted = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    const add: Row[] = Array.from(list)
      .filter((f) => accepted.includes(f.type))
      .map((f) => ({ file: f, status: "pending" as RowStatus }));
    setRows((prev) => [...prev, ...add]);
  }

  async function readAll() {
    setBusy(true); setPhase("reading");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].status === "read" || rows[i].status === "saved") continue;
      setRows((prev) => prev.map((r, k) => (k === i ? { ...r, status: "reading", error: undefined } : r)));
      try {
        const fd = new FormData();
        fd.append("file", rows[i].file);
        fd.append("activity_code", activity);
        const res = await fetch("/api/extract", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Reading failed");
        setRows((prev) => prev.map((r, k) => (k === i ? { ...r, status: "read", result: data } : r)));
      } catch (e: any) {
        setRows((prev) => prev.map((r, k) => (k === i ? { ...r, status: "error", error: e.message } : r)));
      }
    }
    setBusy(false); setPhase("idle");
  }

  async function saveAll() {
    setBusy(true); setPhase("saving");
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.status !== "read" || !r.result) continue;
      setRows((prev) => prev.map((x, k) => (k === i ? { ...x, status: "saving" } : x)));
      try {
        const h = r.result.header;
        const meta = {
          client_id: clientId || null, activity_code: activity, engine: r.result.engine,
          original_filename: r.result.filename,
          header: {
            supplier_name: h.supplier_name, store_name: h.store_name ?? null, supplier_vat: h.supplier_vat,
            invoice_number: h.invoice_number, barcode: h.barcode ?? null, invoice_date: h.invoice_date,
            invoice_time: h.invoice_time ?? null, doc_type: h.doc_type,
            total_net: h.total_net, total_vat: h.total_vat, total_gross: h.total_gross,
          },
          items: r.result.items.map((it) => ({
            description: it.description, quantity: it.quantity, net_amount: it.net_amount,
            vat_rate_on_invoice: it.vat_rate_on_invoice, vat_amount_on_invoice: it.vat_amount_on_invoice,
            expected_vat_rate: it.expected_vat_rate, category_code: it.matched_category?.code ?? null,
            category_name: it.matched_category?.description ?? null, take_credit: !!it.take_credit,
          })),
        };
        const fd = new FormData();
        fd.append("file", r.file);
        fd.append("meta", JSON.stringify(meta));
        const res = await fetch("/api/invoices", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Save failed");
        setRows((prev) => prev.map((x, k) => (k === i ? { ...x, status: "saved", savedId: data.invoice.id } : x)));
      } catch (e: any) {
        setRows((prev) => prev.map((x, k) => (k === i ? { ...x, status: "error", error: e.message } : x)));
      }
    }
    setBusy(false); setPhase("idle");
  }

  const readCount = rows.filter((r) => r.status === "read").length;
  const savedCount = rows.filter((r) => r.status === "saved").length;
  const totalCredit = rows.reduce((a, r) => a + (r.status === "saved" || r.status === "read" ? docCredit(r) : 0), 0);
  const aiCount = rows.reduce((a, r) => a + (r.result?.ai_matched || 0), 0);
  const cacheCount = rows.reduce((a, r) => a + (r.result?.cache_matched || 0), 0);

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Batch import</h1>
        <p className="mt-1 text-muted">
          Drop many invoices/receipts at once. Each document is read and saved as its own record for
          the selected client.
        </p>
      </div>

      <div className="card rise p-5">
        <div className="grid gap-5 sm:grid-cols-[260px_1fr]">
          <div>
            <label className="label" htmlFor="client">Client</label>
            <select id="client" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">No client (generic)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.client_code} · {c.name} ({c.activity_label})</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted">Every document imported goes to this client.</p>
          </div>
          <div>
            <label className="label">Documents</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              onClick={() => inputRef.current?.click()}
              className={`flex h-[104px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors ${dragOver ? "border-brand bg-brand-50" : "border-line bg-paper hover:border-brand/50"}`}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-brand"><path d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <p className="mt-2 text-sm">Drop <strong>multiple</strong> PDFs or images, or <span className="text-brand">browse</span></p>
              <p className="text-xs text-muted">PDF, PNG, JPEG, WebP</p>
              <input ref={inputRef} type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => addFiles(e.target.files)} />
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={readAll} disabled={busy || !rows.some((r) => r.status === "pending" || r.status === "error")}>
            {phase === "reading" ? "Reading…" : `Read all (${rows.length})`}
          </button>
          <button className="btn-primary" onClick={saveAll} disabled={busy || readCount === 0}>
            {phase === "saving" ? "Saving…" : `Save all (${readCount})`}
          </button>
          {rows.length > 0 && !busy && (
            <button className="btn-ghost" onClick={() => setRows([])}>Clear</button>
          )}
          <div className="ml-auto flex flex-wrap gap-2 text-sm">
            {cacheCount > 0 && <span className="chip bg-brand-50 text-brand-700">{cacheCount} from cache</span>}
            {aiCount > 0 && <span className="chip bg-ink text-paper">{aiCount} by AI</span>}
            {savedCount > 0 && <span className="chip-ok">{savedCount} saved</span>}
            <span className="chip bg-brand text-white">Credit € {money(totalCredit)}</span>
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card overflow-hidden rise">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Document</th>
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">Gross €</th>
                  <th className="px-4 py-3 font-medium text-right">Credit €</th>
                  <th className="px-4 py-3 font-medium text-center">Read by</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-line/70 align-middle">
                    <td className="px-4 py-3 max-w-[220px] truncate" title={r.file.name}>{r.file.name}</td>
                    <td className="px-4 py-3">{r.result?.header.supplier_name || "—"}</td>
                    <td className="px-4 py-3 tnum">{r.result?.header.invoice_date || "—"}</td>
                    <td className="px-4 py-3 text-right tnum">{money(r.result?.header.total_gross)}</td>
                    <td className="px-4 py-3 text-right tnum font-semibold text-brand-700">{r.status === "read" || r.status === "saved" ? money(docCredit(r)) : "—"}</td>
                    <td className="px-4 py-3 text-center">
                      {r.result ? <span className="chip bg-paper border border-line text-muted">{engineLabel(r.result.engine)}</span> : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip r={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-muted">
        Each document becomes an <strong>individual invoice</strong> under the selected client. After saving,
        open any of them from <Link href="/records" className="text-brand">Database</Link> to review items, fix
        categories or credit, and see the document.
      </p>
    </div>
  );
}

function StatusChip({ r }: { r: Row }) {
  if (r.status === "saved") return <Link href={`/invoice/${r.savedId}`} className="chip-ok">Saved ✓ open</Link>;
  if (r.status === "error") return <span className="chip-danger" title={r.error}>Error</span>;
  if (r.status === "reading") return <span className="chip bg-brand-50 text-brand-700">Reading…</span>;
  if (r.status === "saving") return <span className="chip bg-brand-50 text-brand-700">Saving…</span>;
  if (r.status === "read") return <span className="chip bg-paper border border-line text-muted">Ready to save</span>;
  return <span className="chip bg-paper border border-line text-muted">Pending</span>;
}
