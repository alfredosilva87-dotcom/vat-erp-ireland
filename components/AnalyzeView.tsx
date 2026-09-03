"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getCurrentClient } from "@/lib/currentClient";
import { useT } from "@/lib/i18n";
import { computeLines } from "@/lib/vat";
// O caminho de ler e gravar mora em lib/ingestFlow.ts desde a camada B2, porque
// a fila do e-mail passou a usar o mesmo caminho. Ver o comentário de lá sobre
// por que duas cópias divergiriam justo no payload de gravação.
import {
  base64ToFile, mergeIntoExisting, readDocumentFile, saveDocument,
  type DuplicateMatch, type IngestDocument, type SupplierRuleHit,
} from "@/lib/ingestFlow";

type Result = IngestDocument;
type RowStatus = "pending" | "reading" | "read" | "error" | "saving" | "saved" | "duplicate" | "discarded" | "split" | "merged";
type Row = { file: File; status: RowStatus; result?: Result; error?: string; savedId?: string; duplicate?: DuplicateMatch | null; splitCount?: number };

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

// O que a regra fez neste documento, escrito por extenso. Sem isto, o crachá
// diria apenas que uma regra existiu — e o contador continuaria sem saber se
// ela mexeu na conta, na alíquota, ou nas duas.
const ruleHint = (r: SupplierRuleHit) => {
  const parts = [`Regra de fornecedor, reconhecida pelo ${r.matched_by === "vat" ? "número de VAT" : "nome"}`];
  if (r.account_code) parts.push(`conta ${r.account_code}`);
  if (r.vat_category_code) parts.push(`categoria ${r.vat_category_code}`);
  if (r.line_items_off) parts.push("itens de linha desligados: uma linha com o total do documento, sem classificação por IA");
  return parts.join(" · ");
};

// How many documents are read in parallel. Saving stays sequential — see saveAll().
// Measured locally at ~21s per document (one Gemini vision call), so a 50-file
// batch lands around 3 minutes. Concurrency 16 was also tested clean (~1.5 min)
// with no rate limiting, so this can be raised if the queue feels slow — 8 is
// the conservative pick for a live demo.
const READ_CONCURRENCY = 8;

/**
 * `lockedClientId` vem de dentro do workspace de um cliente (módulo Compras)
 * — o seletor de cliente fica travado nele, em vez de deixar escolher outro.
 * Sem essa prop é a tela global (`/analyze`), que ainda escolhe o cliente.
 */
export default function AnalyzeView({ lockedClientId }: { lockedClientId?: string } = {}) {
  const { t } = useT();
  const [clients, setClients] = useState<{ id: string; name: string; client_code: string; activity_code: string; activity_label: string; default_credit_unmatched: boolean; related_categories: string[] }[]>([]);
  const [clientId, setClientId] = useState(lockedClientId || "");
  const [branches, setBranches] = useState<{ id: string; name: string; code: string | null }[]>([]);
  const [branchId, setBranchId] = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "reading" | "saving">("idle");
  const [dragOver, setDragOver] = useState(false);
  /** Ficheiros que a zona de largar recusou por tipo — ditos em voz alta. */
  const [skipped, setSkipped] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedClient = clients.find((c) => c.id === clientId);
  // Para onde a tela de revisão volta ao abrir um documento daqui. Dentro do
  // módulo de um cliente é a lista dele; na tela global, o Database.
  const backTo = lockedClientId ? `/clients/${lockedClientId}/analyze` : "/analyze";
  const activity = selectedClient?.activity_code || "GENERIC";
  // Reading never depends on this — a document can be read with no client/branch
  // picked yet. Saving does: once a client has branches registered, every save
  // must be tied to one of them, so a batch started before picking a branch
  // doesn't silently land under the wrong store (or no store at all).
  const branchRequired = branches.length > 0;
  const canSave = !branchRequired || Boolean(branchId);

  useEffect(() => {
    fetch("/api/clients", { cache: "no-store" }).then((r) => r.json()).then((d) => setClients(d.clients || []));
    if (lockedClientId) return;
    const cur = getCurrentClient();
    if (cur) setClientId(cur.id);
  }, [lockedClientId]);

  useEffect(() => {
    setBranchId("");
    if (!clientId) { setBranches([]); return; }
    fetch(`/api/clients/${clientId}/branches`, { cache: "no-store" }).then((r) => r.json()).then((d) => setBranches(d.branches || []));
  }, [clientId]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const accepted = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    const all = Array.from(list);
    const add: Row[] = all
      .filter((f) => accepted.includes(f.type))
      .map((f) => ({ file: f, status: "pending" as RowStatus }));
    /*
     * O FICHEIRO RECUSADO TEM DE SER DITO.
     *
     * A filtragem já existia e está certa — o que faltava era a palavra. Quem
     * arrasta a pasta do mês para dentro do ecrã leva lá dentro um `.doc` ou um
     * `.zip` sem reparar; o contador via "30 ficheiros" na pasta, "28" na
     * tabela, e não tinha como saber que dois tinham ficado de fora. É a
     * diferença entre "importei tudo" e "importei tudo menos aqueles dois".
     */
    const rejected = all.filter((f) => !accepted.includes(f.type)).map((f) => f.name);
    setSkipped(rejected);
    setRows((prev) => [...prev, ...add]);
  }

  // Reading is the slow part (a Gemini call per document), so a batch of 50
  // runs through a small pool of concurrent workers instead of one at a time.
  // READ_CONCURRENCY is deliberately modest to stay clear of Gemini rate limits.
  /**
   * Lê UMA linha. Vive ao nível do componente, e não dentro do `readAll`, para
   * o botão de repetir daquela linha poder chamá-la sozinha — sem isso, repetir
   * uma leitura falhada obrigava a mandar ler o lote todo outra vez, e num lote
   * de 30 com 3 falhas pagavam-se 27 leituras que já estavam boas.
   */
  async function readRow(i: number, file: File) {
    setRows((prev) => prev.map((r, k) => (k === i ? { ...r, status: "reading", error: undefined } : r)));
    try {
      const docs = await readDocumentFile(file, {
        clientId,
        activityCode: activity,
        defaultCreditUnmatched: selectedClient?.default_credit_unmatched ?? false,
        relatedCategories: selectedClient?.related_categories ?? [],
      });
      if (docs.length <= 1 && docs[0]) {
        setRows((prev) => prev.map((r, k) => (k === i ? { ...r, status: "read", result: docs[0] } : r)));
        return;
      }
      // Batch PDF split into several invoices: keep the original row as a
      // marker (appended children preserve every other in-flight index)
      // and append one saveable row per detected invoice.
      const children: Row[] = docs.map((d) => ({
        file: d.pdf_base64 ? base64ToFile(d.pdf_base64, d.filename) : file,
        status: "read" as RowStatus,
        result: d,
      }));
      setRows((prev) => {
        const next = prev.slice();
        next[i] = { ...next[i], status: "split", splitCount: docs.length };
        return [...next, ...children];
      });
    } catch (e: any) {
      setRows((prev) => prev.map((r, k) => (k === i ? { ...r, status: "error", error: e.message } : r)));
    }
  }

  async function readAll() {
    setBusy(true); setPhase("reading");

    const queue = rows
      .map((r, i) => (r.status === "read" || r.status === "saved" || r.status === "discarded" || r.status === "split" ? -1 : i))
      .filter((i) => i >= 0);
    let cursor = 0;

    async function worker() {
      while (cursor < queue.length) {
        const i = queue[cursor++];
        await readRow(i, rows[i].file);
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
      const out = await saveDocument(r.file, r.result, {
        // Esta tela é sempre arquivo escolhido à mão — a caixa de entrada tem
        // a sua própria origem (e-mail/telefone) e não passa por aqui.
        clientId, branchId, activityCode: activity, postingDate, force, source: "upload",
      });
      if (out.kind === "duplicate") {
        setRows((prev) => prev.map((x, k) => (k === i ? { ...x, status: "duplicate", duplicate: out.existing } : x)));
        return;
      }
      setRows((prev) => prev.map((x, k) => (k === i ? { ...x, status: "saved", savedId: out.id } : x)));
    } catch (e: any) {
      setRows((prev) => prev.map((x, k) => (k === i ? { ...x, status: "error", error: e.message } : x)));
    }
  }

  /**
   * Junta o documento desta duplicata ao lançamento que já existe (camada B3).
   *
   * Antes só havia "gravar de todo jeito" (que duplica o lançamento) e
   * "descartar" (que joga a imagem fora). A segunda foto do mesmo recibo é
   * frequentemente a mais legível das duas, e era ela que se perdia.
   */
  async function mergeRow(i: number) {
    const r = rows[i];
    if (!r.duplicate) return;
    setRows((prev) => prev.map((x, k) => (k === i ? { ...x, status: "saving" } : x)));
    const out = await mergeIntoExisting(r.file, r.duplicate.id, r.result?.filename);
    setRows((prev) => prev.map((x, k) => (k === i
      ? out.ok
        ? { ...x, status: "merged" as RowStatus, savedId: r.duplicate!.id }
        : { ...x, status: "duplicate" as RowStatus, error: out.error }
      : x)));
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
  const savedIds = rows.filter((r) => r.status === "saved" && r.savedId).map((r) => r.savedId as string);
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
            <select id="client" className="input" value={clientId} disabled={!!lockedClientId} onChange={(e) => setClientId(e.target.value)}>
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
            {skipped.length > 0 && (
              <div className="mt-2 rounded-lg border border-warning/40 bg-warning-50 px-3 py-2 text-xs">
                <p className="font-medium">
                  {skipped.length === 1
                    ? t("analyze.skippedOne")
                    : t("analyze.skippedMany").replace("{n}", String(skipped.length))}
                </p>
                <p className="mt-1 text-muted break-words">{skipped.join(", ")}</p>
                <button className="mt-1 underline" onClick={(e) => { e.stopPropagation(); setSkipped([]); }}>
                  {t("common.dismiss")}
                </button>
              </div>
            )}
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
          {savedIds.length > 0 && (
            <Link
              className="btn-ghost"
              href={lockedClientId ? `/clients/${lockedClientId}/purchases?ids=${savedIds.join(",")}` : `/records?ids=${savedIds.join(",")}`}
            >
              {t("analyze.reviewBatch", { n: String(savedIds.length) })}
            </Link>
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
                  <tr key={i} className={`border-b border-line/70 align-middle ${r.status === "split" ? "text-muted" : ""}`}>
                    <td className="px-4 py-3 max-w-[220px] truncate" title={r.file.name}>{r.file.name}</td>
                    {r.status === "split" ? (
                      <td className="px-4 py-3 text-xs" colSpan={6}>Split into {r.splitCount} invoice(s) — see the rows below.</td>
                    ) : (
                      <>
                        <td className="px-4 py-3">{r.result?.header.supplier_name || "—"}</td>
                        <td className="px-4 py-3 tnum">{r.result?.header.invoice_date || "—"}</td>
                        <td className="px-4 py-3 tnum text-muted">{postingDate || "—"}</td>
                        <td className="px-4 py-3 text-right tnum">{money(r.result?.header.total_gross)}</td>
                        <td className="px-4 py-3 text-right tnum font-semibold text-brand-700">{r.status === "read" || r.status === "saved" ? money(docCredit(r)) : "—"}</td>
                        <td className="px-4 py-3 text-center">
                          {r.result ? (
                            <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
                              <span className="chip bg-surface-2 border border-line text-muted">{engineLabel(r.result.engine)}</span>
                              {r.result.supplier_rule && (
                                <span
                                  className="chip bg-brand-50 text-brand-700"
                                  title={ruleHint(r.result.supplier_rule)}
                                >
                                  {r.result.supplier_rule.label}
                                  {r.result.supplier_rule.line_items_off ? " · 1 linha" : ""}
                                </span>
                              )}
                              {r.result.needs_review && (
                                <span className="chip-warn" title={r.result.issues.join("; ") || t("analyze.lowConfidence")}>
                                  {t("analyze.needsReview")}
                                </span>
                              )}
                            </span>
                          ) : "—"}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-3">
                      <StatusChip r={r} canSave={canSave} backTo={backTo} onForceSave={() => saveOne(i, true)} onMerge={() => mergeRow(i)} onDiscard={() => discardRow(i)} onRetry={() => readRow(i, r.file)} />
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

/**
 * `backTo` mantém o menu do módulo de pé ao abrir um documento daqui: sem ele,
 * a tela de revisão não sabe de que cliente é a nota e cai no menu geral.
 */
function StatusChip({ r, canSave, backTo, onForceSave, onMerge, onDiscard, onRetry }: { r: Row; canSave: boolean; backTo: string; onForceSave: () => void; onMerge: () => void; onDiscard: () => void; onRetry: () => void }) {
  const { t: tt } = useT();
  const open = (id: string | undefined) => `/invoice/${id}?from=${encodeURIComponent(backTo)}`;
  if (r.status === "saved") return <Link href={open(r.savedId)} className="chip-ok">{tt("analyze.statusSaved")}</Link>;
  if (r.status === "discarded") return <span className="chip bg-surface-2 border border-line text-muted">{tt("analyze.statusDiscarded")}</span>;
  if (r.status === "split") return <span className="chip bg-surface-2 border border-line text-muted">Split into {r.splitCount}</span>;
  if (r.status === "merged") return (
    <Link href={open(r.savedId)} className="chip-ok" title="A imagem foi anexada ao lançamento que já existia.">
      juntada
    </Link>
  );
  if (r.status === "duplicate") {
    const d = r.duplicate;
    const hint = d
      ? tt("analyze.duplicateHint", { number: d.invoice_number || "—", date: d.posting_date || "—" })
      : tt("analyze.duplicateOf");
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {d ? (
          <Link href={open(d.id)} className="chip-warn" title={hint}>{tt("analyze.statusDuplicate")}</Link>
        ) : (
          <span className="chip-warn">{tt("analyze.statusDuplicate")}</span>
        )}
        {d && (
          <button onClick={onMerge} className="text-xs text-brand underline underline-offset-2"
            title="Anexa esta imagem ao lançamento que já existe, sem criar outro. Nada do lançamento muda.">
            juntar
          </button>
        )}
        {canSave && (
          <button onClick={onForceSave} className="text-xs text-brand underline underline-offset-2">
            {tt("analyze.saveAnyway")}
          </button>
        )}
        <button onClick={onDiscard} className="text-xs text-muted underline underline-offset-2">
          {tt("analyze.discard")}
        </button>
        {r.error && <span className="text-xs text-danger">{r.error}</span>}
      </span>
    );
  }
  /*
   * O ERRO DEIXA DE SER A PALAVRA "ERROR".
   *
   * Era um `chip-danger` com a causa escondida num `title` — ou seja, só
   * aparecia a quem passasse o rato por cima e soubesse que valia a pena. Ao
   * lado de 50 s de espera, isso não é uma mensagem, é um beco.
   *
   * Agora a causa está escrita na linha (`lib/ingestFlow.ts` traduz o estado
   * HTTP para linguagem de gente e diz se vale a pena repetir), e o `Repetir`
   * vive AQUI, na linha que falhou. É a diferença entre repetir 3 leituras e
   * repetir 30.
   */
  if (r.status === "error") return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="chip-danger">{tt("analyze.statusError")}</span>
      <button onClick={onRetry} className="text-xs text-brand underline underline-offset-2">
        {tt("analyze.retry")}
      </button>
      {r.error && <span className="block w-full text-xs text-muted">{r.error}</span>}
    </span>
  );
  if (r.status === "reading") return <span className="chip bg-brand-50 text-brand-700">{tt("analyze.statusReading")}</span>;
  if (r.status === "saving") return <span className="chip bg-brand-50 text-brand-700">{tt("analyze.statusSaving")}</span>;
  if (r.status === "read") return <span className="chip bg-surface-2 border border-line text-muted">{tt("analyze.statusReady")}</span>;
  return <span className="chip bg-surface-2 border border-line text-muted">{tt("analyze.statusPending")}</span>;
}
