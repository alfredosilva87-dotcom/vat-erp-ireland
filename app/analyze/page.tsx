"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getCurrentClient } from "@/lib/currentClient";
import { useT } from "@/lib/i18n";
import type { AnalyzedItem } from "@/lib/types";
import { computeLines } from "@/lib/vat";

type Header = {
  supplier_name: string | null; store_name: string | null; supplier_vat: string | null;
  invoice_number: string | null; barcode: string | null; invoice_date: string | null;
  invoice_time: string | null; doc_type: string;
  total_net: number | null; total_vat: number | null; total_gross: number | null;
};
type Result = {
  filename: string; engine: string; confidence: number; needs_review: boolean; issues: string[];
  audit?: { engine: string; confidence: number }[]; base_source: string;
  ai_matched?: number; cache_matched?: number; header: Header; items: AnalyzedItem[];
};
type RowStatus = "pending" | "reading" | "read" | "error" | "saving" | "saved" | "duplicate" | "discarded";
type DuplicateMatch = { id: string; invoice_number: string | null; posting_date: string | null; total_gross: number | null };
type Row = { file: File; status: RowStatus; result?: Result; error?: string; savedId?: string; duplicate?: DuplicateMatch };

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Preview credit for one document, using the same VAT helper as the server.
const docCredit = (r: Row) => {
  if (!r.result) return 0;
  const h = r.result.header;
  const { lines } = computeLines(r.result.items, {
    total_net: h.total_net, total_vat: h.total_vat, total_gross: h.total_gross,
  });
  return r.result.items.reduce((a, it, i) => a + (it.take_credit ? lines[i].vat : 0), 0);
};
const engineLabel = (e?: string) => e === "pdf-native" ? "PDF" : e === "gemini-vision" ? "AI" : e === "tesseract" ? "OCR" : "—";

// How many documents are read in parallel. Saving stays sequential — see saveAll().
// Measured locally at ~21s per document (one Gemini vision call), so a 50-file
// batch lands around 3 minutes. Concurrency 16 was also tested clean (~1.5 min)
// with no rate limiting, so this can be raised if the queue feels slow — 8 is
// the conservative pick for a live demo.
const READ_CONCURRENCY = 8;

export default function Analyze() {
  const { t } = useT();
  const [clients, setClients] = useState<{ id: string; name: string; client_code: string; activity_code: string; activity_label: string; default_credit_unmatched: boolean }[]>([]);
  const [clientId, setClientId] = useState("");
  const [branches, setBranches] = useState<{ id: string; name: string; code: string | null }[]>([]);
  const [branchId, setBranchId] = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "reading" | "saving">("idle");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedClient = clients.find((c) => c.id === clientId);
  const activity = selectedClient?.activity_code || "GENERIC";
  // Reading never depends on this — a document can be read with no client/branch
  // picked yet. Saving does: once a client has branches registered, every save
  // must be tied to one of them, so a batch started before picking a branch
  // doesn't silently land under the wrong store (or no store at all).
  const branchRequired = branches.length > 0;
  const canSave = !branchRequired || Boolean(branchId);

  useEffect(() => {
    fetch("/api/clients").then((r) => r.json()).then((d) => setClients(d.clients || []));
    const cur = getCurrentClient();
    if (cur) setClientId(cur.id);
  }, []);

  useEffect(() => {
    setBranchId("");
    if (!clientId) { setBranches([]); return; }
    fetch(`/api/clients/${clientId}/branches`).then((r) => r.json()).then((d) => setBranches(d.branches || []));
  }, [clientId]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const accepted = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    const add: Row[] = Array.from(list)
      .filter((f) => accepted.includes(f.type))
      .map((f) => ({ file: f, status: "pending" as RowStatus }));
    setRows((prev) => [...prev, ...add]);
  }

  // Reading is the slow part (a Gemini call per document), so a batch of 50
  // runs through a small pool of concurrent workers instead of one at a time.
  // READ_CONCURRENCY is deliberately modest to stay clear of Gemini rate limits.
  async function readAll() {
    setBusy(true); setPhase("reading");

    const queue = rows
      .map((r, i) => (r.status === "read" || r.status === "saved" || r.status === "discarded" ? -1 : i))
      .filter((i) => i >= 0);
    let cursor = 0;

    async function readOne(i: number) {
      setRows((prev) => prev.map((r, k) => (k === i ? { ...r, status: "reading", error: undefined } : r)));
      try {
        const fd = new FormData();
        fd.append("file", rows[i].file);
        fd.append("activity_code", activity);
        fd.append("default_credit_unmatched", String(selectedClient?.default_credit_unmatched ?? false));
        const res = await fetch("/api/extract", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Reading failed");
        setRows((prev) => prev.map((r, k) => (k === i ? { ...r, status: "read", result: data } : r)));
      } catch (e: any) {
        setRows((prev) => prev.map((r, k) => (k === i ? { ...r, status: "error", error: e.message } : r)));
      }
    }

    async function worker() {
      while (cursor < queue.length) {
        const i = queue[cursor++];
        await readOne(i);
      }
    }

    await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, queue.length) }, worker));
    setBusy(false); setPhase("idle");
  }

  // Kept sequential on purpose: saveInvoice() resolves each line item through
  // findOrCreateMaster(), a select-then-insert against items_master, which has
  // a UNIQUE index on norm_key. Concurrent saves sharing an item description
  // would race and hit that constraint. Saving is only DB writes, so it is
  // fast anyway — the time in a batch is in the reading phase above.
  async function saveOne(i: number, force = false) {
    const r = rows[i];
    if (!r.result) return;
    if (!canSave) return; // guarded again at the button level; belt-and-braces here.
    setRows((prev) => prev.map((x, k) => (k === i ? { ...x, status: "saving" } : x)));
    try {
      const h = r.result.header;
      const meta = {
        client_id: clientId || null, branch_id: branchId || null, activity_code: activity, engine: r.result.engine,
        original_filename: r.result.filename,
        confidence: r.result.confidence, needs_review: r.result.needs_review, issues: r.result.issues,
        audit: r.result.audit,
        header: {
          supplier_name: h.supplier_name, store_name: h.store_name ?? null, supplier_vat: h.supplier_vat,
          invoice_number: h.invoice_number, barcode: h.barcode ?? null, invoice_date: h.invoice_date,
          posting_date: postingDate || null,
          invoice_time: h.invoice_time ?? null, doc_type: h.doc_type,
          total_net: h.total_net, total_vat: h.total_vat, total_gross: h.total_gross,
        },
        items: r.result.items.map((it) => ({
          description: it.description, quantity: it.quantity, unit_price: it.unit_price, net_amount: it.net_amount,
          vat_rate_on_invoice: it.vat_rate_on_invoice, vat_amount_on_invoice: it.vat_amount_on_invoice,
          expected_vat_rate: it.expected_vat_rate, category_code: it.matched_category?.code ?? null,
          category_name: it.matched_category?.description ?? null, take_credit: !!it.take_credit,
        })),
      };
      const fd = new FormData();
      fd.append("file", r.file);
      fd.append("meta", JSON.stringify(meta));
      if (force) fd.append("force", "true");
      const res = await fetch("/api/invoices", { method: "POST", body: fd });
      const data = await res.json();
      if (res.status === 409 && data.error === "duplicate") {
        setRows((prev) => prev.map((x, k) => (k === i ? { ...x, status: "duplicate", duplicate: data.existing } : x)));
        return;
      }
      if (!res.ok) throw new Error(data.error || "Save failed");
      setRows((prev) => prev.map((x, k) => (k === i ? { ...x, status: "saved", savedId: data.invoice.id } : x)));
    } catch (e: any) {
      setRows((prev) => prev.map((x, k) => (k === i ? { ...x, status: "error", error: e.message } : x)));
    }
  }

  async function saveAll() {
    if (!canSave) return;
    setBusy(true); setPhase("saving");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].status !== "read" || !rows[i].result) continue;
      await saveOne(i);
    }
    setBusy(false); setPhase("idle");
  }

  function discardRow(i: number) {
    setRows((prev) => prev.map((x, k) => (k === i ? { ...x, status: "discarded" } : x)));
  }

  const readCount = rows.filter((r) => r.status === "read").length;
  const savedCount = rows.filter((r) => r.status === "saved").length;
  const totalCredit = rows.reduce((a, r) => a + (r.status === "saved" || r.status === "read" ? docCredit(r) : 0), 0);
  const aiCount = rows.reduce((a, r) => a + (r.result?.ai_matched || 0), 0);
  const cacheCount = rows.reduce((a, r) => a + (r.result?.cache_matched || 0), 0);
  const reviewCount = rows.filter((r) => r.result?.needs_review).length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  // Progress for the phase currently running, so a 50-document batch shows
  // movement instead of a frozen button.
  const doneCount = phase === "saving" ? savedCount : readCount + savedCount + errorCount;
  const progressPct = rows.length ? Math.round((doneCount / rows.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t("analyze.title")}</h1>
        <p className="mt-1 text-muted">
{t("analyze.subtitle")}
        </p>
      </div>

      <div className="card rise p-5">
        <div className="grid gap-5 sm:grid-cols-[260px_1fr]">
          <div>
            <label className="label" htmlFor="client">{t("analyze.client")}</label>
            <select id="client" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">{t("analyze.noClientGeneric")}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.client_code} · {c.name} ({c.activity_label})</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted">{t("analyze.clientHelp")}</p>

            <label className="label mt-4" htmlFor="posting">{t("analyze.postingDate")}</label>
            <input
              id="posting"
              type="date"
              className="input"
              value={postingDate}
              onChange={(e) => setPostingDate(e.target.value)}
            />
            <p className="mt-2 text-xs text-muted">
{t("analyze.postingHelp")}
            </p>

            {branches.length > 0 && (
              <>
                <label className="label mt-4" htmlFor="branch">Branch / loja</label>
                <select id="branch" className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  <option value="">{t("analyze.noBranch")}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.code ? `${b.code} · ` : ""}{b.name}</option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-muted">{t("analyze.branchHelp")}</p>
              </>
            )}
          </div>
          <div>
            <label className="label">{t("analyze.documents")}</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              onClick={() => inputRef.current?.click()}
              className={`flex h-[104px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors ${dragOver ? "border-brand bg-brand-50" : "border-line bg-surface-2/50 hover:border-brand/50"}`}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-brand"><path d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <p className="mt-2 text-sm">{t("analyze.drop")} <span className="text-brand">{t("analyze.browse")}</span></p>
              <p className="text-xs text-muted">PDF, PNG, JPEG, WebP</p>
              <input ref={inputRef} type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => addFiles(e.target.files)} />
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={readAll} disabled={busy || !rows.some((r) => r.status === "pending" || r.status === "error")}>
            {phase === "reading" ? t("analyze.reading") : `${t("analyze.readAll")} (${rows.length})`}
          </button>
          <button className="btn-primary" onClick={saveAll} disabled={busy || readCount === 0 || !canSave}>
            {phase === "saving" ? t("common.saving") : `${t("analyze.saveAll")} (${readCount})`}
          </button>
          {rows.length > 0 && !busy && (
            <button className="btn-ghost" onClick={() => setRows([])}>{t("common.clear")}</button>
          )}
          <div className="ml-auto flex flex-wrap gap-2 text-sm">
            {cacheCount > 0 && <span className="chip bg-brand-50 text-brand-700">{cacheCount} {t("analyze.fromCache")}</span>}
            {aiCount > 0 && <span className="chip bg-ink text-paper">{aiCount} {t("analyze.byAI")}</span>}
            {reviewCount > 0 && <span className="chip-warn">{reviewCount} {t("analyze.needReview")}</span>}
            {savedCount > 0 && <span className="chip-ok">{savedCount} {t("analyze.saved")}</span>}
            <span className="chip bg-brand text-white">{t("dash.credit")} {money(totalCredit)}</span>
          </div>
        </div>

        {branchRequired && !branchId && readCount > 0 && (
          <div className="mt-4 rounded-xl border border-warning/30 bg-warning-50 px-4 py-2.5 text-sm text-warning" role="alert">
            {t("analyze.selectBranchToSave")}
          </div>
        )}

        {busy && rows.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>
                {phase === "reading" ? t("analyze.readingDocs") : t("analyze.savingDocs")} · {doneCount} {t("analyze.ofCount")} {rows.length}
                {phase === "reading" && rows.length > READ_CONCURRENCY && ` · ${READ_CONCURRENCY} ${t("analyze.atATime")}`}
              </span>
              <span className="tnum">{progressPct}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="card overflow-hidden rise">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">{t("analyze.document")}</th>
                  <th className="px-4 py-3 font-medium">{t("analyze.supplier")}</th>
                  <th className="px-4 py-3 font-medium">{t("analyze.issued")}</th>
                  <th className="px-4 py-3 font-medium">{t("analyze.posting")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("analyze.gross")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("analyze.creditCol")}</th>
                  <th className="px-4 py-3 font-medium text-center">{t("analyze.readBy")}</th>
                  <th className="px-4 py-3 font-medium">{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-line/70 align-middle">
                    <td className="px-4 py-3 max-w-[220px] truncate" title={r.file.name}>{r.file.name}</td>
                    <td className="px-4 py-3">{r.result?.header.supplier_name || "—"}</td>
                    <td className="px-4 py-3 tnum">{r.result?.header.invoice_date || "—"}</td>
                    <td className="px-4 py-3 tnum text-muted">{postingDate || "—"}</td>
                    <td className="px-4 py-3 text-right tnum">{money(r.result?.header.total_gross)}</td>
                    <td className="px-4 py-3 text-right tnum font-semibold text-brand-700">{r.status === "read" || r.status === "saved" ? money(docCredit(r)) : "—"}</td>
                    <td className="px-4 py-3 text-center">
                      {r.result ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="chip bg-surface-2 border border-line text-muted">{engineLabel(r.result.engine)}</span>
                          {r.result.needs_review && (
                            <span className="chip-warn" title={r.result.issues.join("; ") || t("analyze.lowConfidence")}>
                              {t("analyze.needsReview")}
                            </span>
                          )}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip r={r} canSave={canSave} onForceSave={() => saveOne(i, true)} onDiscard={() => discardRow(i)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-muted">
        {t("analyze.footer")}
      </p>
    </div>
  );
}

function StatusChip({ r, canSave, onForceSave, onDiscard }: { r: Row; canSave: boolean; onForceSave: () => void; onDiscard: () => void }) {
  const { t: tt } = useT();
  if (r.status === "saved") return <Link href={`/invoice/${r.savedId}`} className="chip-ok">{tt("analyze.statusSaved")}</Link>;
  if (r.status === "discarded") return <span className="chip bg-surface-2 border border-line text-muted">{tt("analyze.statusDiscarded")}</span>;
  if (r.status === "duplicate") {
    const d = r.duplicate;
    const hint = d
      ? tt("analyze.duplicateHint", { number: d.invoice_number || "—", date: d.posting_date || "—" })
      : tt("analyze.duplicateOf");
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {d ? (
          <Link href={`/invoice/${d.id}`} className="chip-warn" title={hint}>{tt("analyze.statusDuplicate")}</Link>
        ) : (
          <span className="chip-warn">{tt("analyze.statusDuplicate")}</span>
        )}
        {canSave && (
          <button onClick={onForceSave} className="text-xs text-brand underline underline-offset-2">
            {tt("analyze.saveAnyway")}
          </button>
        )}
        <button onClick={onDiscard} className="text-xs text-muted underline underline-offset-2">
          {tt("analyze.discard")}
        </button>
      </span>
    );
  }
  if (r.status === "error") return <span className="chip-danger" title={r.error}>{tt("analyze.statusError")}</span>;
  if (r.status === "reading") return <span className="chip bg-brand-50 text-brand-700">{tt("analyze.statusReading")}</span>;
  if (r.status === "saving") return <span className="chip bg-brand-50 text-brand-700">{tt("analyze.statusSaving")}</span>;
  if (r.status === "read") return <span className="chip bg-surface-2 border border-line text-muted">{tt("analyze.statusReady")}</span>;
  return <span className="chip bg-surface-2 border border-line text-muted">{tt("analyze.statusPending")}</span>;
}
