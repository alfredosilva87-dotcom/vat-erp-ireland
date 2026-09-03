"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoredInvoice, MasterItem } from "@/lib/types";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getCurrentClient } from "@/lib/currentClient";
import ExportPanel from "@/components/ExportPanel";
import { useT } from "@/lib/i18n";
import { rememberOpenedRow, useScrollToRow } from "@/lib/useScrollToRow";

type Stats = { invoices: number; items: number; unique_items: number; total_credit: number };

const money = (n: number | null) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Records() {
  const { t } = useT();
  const searchParams = useSearchParams();
  // A just-imported batch (see Analyze's "Review this batch") locks the list
  // to exactly those invoices, ignoring the usual filters, until cleared.
  const batchIds = searchParams.get("ids");
  // Mesma razão do cliente: "← Database" e o pós-exclusão precisam voltar pro
  // MESMO lote, não pra lista inteira, senão abrir um documento e sair perde
  // o filtro que trouxe a pessoa até ali.
  const backHref = `/records${batchIds ? `?ids=${batchIds}` : ""}`;
  const [tab, setTab] = useState<"invoices" | "items">("invoices");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [invoices, setInvoices] = useState<StoredInvoice[]>([]);
  const [items, setItems] = useState<MasterItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<{ id: string; name: string; client_code: string }[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const [branches, setBranches] = useState<{ id: string; name: string; code: string | null }[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [onlyReview, setOnlyReview] = useState(false);
  // Aprovação em lote (camada B3): o que está marcado, e o resultado da última
  // passada.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const [approveMsg, setApproveMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ q: query });
      if (batchIds) {
        p.set("ids", batchIds);
      } else {
        if (clientId) p.set("client", clientId);
        if (branchId) p.set("branch", branchId);
        if (start) p.set("start", start);
        if (end) p.set("end", end);
        if (onlyReview) p.set("review", "1");
      }
      if (tab === "items") p.set("view", "items");
      const res = await fetch(`/api/invoices?${p.toString()}`, { cache: "no-store" });
      const data = await res.json();
      setStats(data.stats);
      if (tab === "items") setItems(data.items || []);
      else setInvoices(data.invoices || []);
    } finally {
      setLoading(false);
    }
  }, [tab, query, clientId, branchId, start, end, onlyReview, batchIds]);

  const highlightId = useScrollToRow(invoices.map((i) => i.id));

  // A seleção não sobrevive a uma troca de filtro: manter marcada uma nota que
  // saiu da tela faria alguém aprovar em lote o que não está mais vendo.
  useEffect(() => { setPicked(new Set()); setApproveMsg(null); }, [tab, query, clientId, branchId, start, end, onlyReview, batchIds]);

  const pending = invoices.filter((i) => !i.reviewed_at);
  const pickedPending = pending.filter((i) => picked.has(i.id));

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setPicked((prev) => (prev.size === pending.length ? new Set() : new Set(pending.map((i) => i.id))));
  }

  /**
   * "Conferi estas vinte, todas certas."
   *
   * Aprovar não mexe em valor, crédito nem alíquota — é reversível e por isso não
   * exige administrador. O que ele grava é NOME e HORA na trilha de cada nota,
   * que é o que faltava: antes, "não pede revisão" e "alguém conferiu" eram a
   * mesma tela.
   */
  async function approvePicked() {
    if (!pickedPending.length) return;
    setApproving(true); setApproveMsg(null);
    try {
      const res = await fetch("/api/invoices/approve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: pickedPending.map((i) => i.id) }),
      });
      const d = await res.json();
      if (!res.ok) { setApproveMsg({ text: d.error || "Erro ao aprovar.", error: true }); return; }
      const parts = [`${d.approved.length} nota(s) aprovada(s)`];
      if (d.alreadyApproved?.length) parts.push(`${d.alreadyApproved.length} já estava(m)`);
      setApproveMsg({ text: parts.join(" · ") });
      setPicked(new Set());
      await load();
    } finally { setApproving(false); }
  }

  const filtersOn = !!(start || end || onlyReview || clientId || branchId || query);
  function clearFilters() {
    setStart(""); setEnd(""); setOnlyReview(false); setBranchId(""); setQ(""); setQuery("");
  }

  useEffect(() => {
    fetch("/api/clients", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setClients(d.clients || []));
    const cur = getCurrentClient();
    if (cur) setClientId(cur.id);
  }, []);

  useEffect(() => {
    setBranchId("");
    if (!clientId) { setBranches([]); return; }
    fetch(`/api/clients/${clientId}/branches`, { cache: "no-store" }).then((r) => r.json()).then((d) => setBranches(d.branches || []));
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-8">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{t("records.title")}</h1>
          <p className="mt-1 text-muted">{t("records.subtitle")}</p>
        </div>
        {stats && (
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="chip bg-surface-2 border border-line text-muted">{stats.invoices} {t("records.invoices")}</span>
            <span className="chip bg-surface-2 border border-line text-muted">{stats.unique_items} {t("records.uniqueItems")}</span>
            <span className="chip bg-brand text-white">{t("dash.credit")} {money(stats.total_credit)}</span>
          </div>
        )}
      </div>

      {batchIds && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/40 bg-brand-50 px-4 py-2.5 text-sm">
          Showing only the {batchIds.split(",").filter(Boolean).length} invoice(s) just imported.
          <Link className="btn-ghost ml-auto h-8 px-3 text-xs" href="/records">Show all invoices</Link>
        </div>
      )}

      {/* Tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          {(["invoices", "items"] as const).map((tt) => (
            <button
              key={tt}
              onClick={() => setTab(tt)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === tt ? "bg-brand text-white" : "text-muted hover:text-ink"
              }`}
            >
              {tt === "invoices" ? t("records.invoices") : t("records.uniqueItems")}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-56" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">{t("records.allClients")}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.client_code} · {c.name}</option>
            ))}
            {/*
              As faturas que sobreviveram ao cliente. Sem esta opção, apagar um
              cliente fazia os documentos dele saírem da interface para sempre —
              continuavam na base, como a confirmação promete, mas nenhum filtro
              chegava lá.
            */}
            <option value="__none__">{t("records.noClient")}</option>
          </select>
          {tab === "invoices" && branches.length > 0 && (
            <select className="input w-44" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{t("records.allBranches")}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.code ? `${b.code} · ` : ""}{b.name}</option>
              ))}
            </select>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(q);
            }}
            className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
          >
          {/*
            `w-64` fixo dentro de uma barra em `overflow: visible`: no telemóvel
            a linha media 488 px num contentor de 343, e como a PÁGINA não
            desliza na horizontal, o que passava dos 375 px ficava cortado e sem
            forma de lá chegar — via-se menos de metade do que se escrevia.
            `w-full sm:w-64` deixa o campo encolher onde não há espaço e mantém
            a largura confortável onde há. A tabela ao lado, no mesmo ecrã, já
            fazia o correcto com o seu próprio `overflow-x-auto`.
          */}
          <input
            className="input w-full sm:w-64"
            placeholder={t("records.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn-primary" type="submit">
            <SearchIcon /> {t("common.search")}
          </button>
          </form>
        </div>
      </div>

      {/* Period + status filters */}
      {tab === "invoices" && (
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="label">{t("records.postingFrom")}</label>
            <input type="date" className="input h-9 w-40 text-sm" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="label">{t("common.to")}</label>
            <input type="date" className="input h-9 w-40 text-sm" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1.5 pb-0.5">
            {([["month", "records.thisMonth"], ["prev", "records.lastMonth"], ["year", "records.thisYear"]] as const).map(([k, lbl]) => (
              <button
                key={k}
                className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
                onClick={() => {
                  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
                  const p = (x: number) => String(x).padStart(2, "0");
                  const f = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
                  if (k === "month") { setStart(f(new Date(y, m, 1))); setEnd(f(new Date(y, m + 1, 0))); }
                  else if (k === "prev") { setStart(f(new Date(y, m - 1, 1))); setEnd(f(new Date(y, m, 0))); }
                  else { setStart(`${y}-01-01`); setEnd(`${y}-12-31`); }
                }}
              >
                {t(lbl as any)}
              </button>
            ))}
          </div>

          <label className="flex cursor-pointer items-center gap-2 pb-1.5 text-sm">
            <input
              type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)}
              className="h-3.5 w-3.5 accent-[rgb(var(--c-brand))]"
            />
            {t("records.onlyReview")}
          </label>

          <div className="ml-auto flex flex-wrap items-center gap-2 pb-0.5">
            {filtersOn && (
              <button className="btn-ghost h-9 px-3 text-xs" onClick={clearFilters}>{t("records.clearFilters")}</button>
            )}
            {clientId ? (
              <ExportPanel clientId={clientId} />
            ) : (
              <span className="text-xs text-muted">{t("records.pickClient")}</span>
            )}
          </div>
        </div>
      )}

      {tab === "invoices" && pending.length > 0 && (
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <label className="flex flex-wrap cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-3.5 w-3.5 accent-[rgb(var(--c-brand))]"
              checked={picked.size > 0 && picked.size === pending.length} onChange={toggleAll} />
            marcar as {pending.length} não conferidas
          </label>
          <button className="btn-primary h-9 px-4 text-sm" disabled={approving || !pickedPending.length}
            onClick={approvePicked}>
            {approving ? "Aprovando…" : `Conferi — aprovar (${pickedPending.length})`}
          </button>
          {approveMsg && (
            <span className={`text-sm ${approveMsg.error ? "text-danger" : "text-brand-700"}`}>{approveMsg.text}</span>
          )}
          <span className="ml-auto text-xs text-muted">
            Aprovar grava nome e hora no histórico de cada nota. Não mexe em valor nem em crédito.
          </span>
        </div>
      )}

      {/* Invoices */}
      {tab === "invoices" && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="w-8 px-3 py-3 font-medium"></th>
                  <th className="px-4 py-3 font-medium">{t("analyze.supplier")}</th>
                  <th className="px-4 py-3 font-medium">{t("records.branch")}</th>
                  <th className="px-4 py-3 font-medium">{t("analyze.issued")}</th>
                  <th className="px-4 py-3 font-medium">{t("analyze.posting")}</th>
                  <th className="px-4 py-3 font-medium">{t("records.docNo")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("records.itemsCol")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("analyze.gross")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("analyze.creditCol")}</th>
                  <th className="px-4 py-3 font-medium text-center">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id} id={`row-${inv.id}`}
                    className={`border-b border-line/70 align-top transition-colors ${highlightId === inv.id ? "bg-brand-50/70" : ""}`}
                  >
                    <td className="px-3 py-3 align-middle">
                      {!inv.reviewed_at && (
                        <input type="checkbox" className="h-3.5 w-3.5 accent-[rgb(var(--c-brand))]"
                          checked={picked.has(inv.id)} onChange={() => toggle(inv.id)}
                          aria-label={`Marcar ${inv.supplier_name || "nota"}`} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{inv.supplier_name || "Unknown"}</span>
                        {inv.needs_review && (
                          <span className="chip-warn" title={inv.review_notes?.join("; ") || t("analyze.lowConfidence")}>
                            {t("records.review")}
                          </span>
                        )}
                        {inv.reviewed_at && (
                          <span className="chip-ok" title={`Aprovada por ${inv.reviewed_by_email || "usuário não registrado"} em ${inv.reviewed_at.slice(0, 16).replace("T", " ")}`}>
                            conferida
                          </span>
                        )}
                      </div>
                      {inv.supplier_vat && (
                        <div className="text-xs text-muted font-mono">{inv.supplier_vat}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{inv.branch_name || "—"}</td>
                    <td className="px-4 py-3 tnum">
                      {inv.invoice_date || "—"}
                      {inv.invoice_time ? ` · ${inv.invoice_time}` : ""}
                    </td>
                    <td className="px-4 py-3 tnum">{inv.posting_date || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{inv.invoice_number || "—"}</td>
                    <td className="px-4 py-3 text-right tnum">{inv.item_count}</td>
                    <td className="px-4 py-3 text-right tnum">{money(inv.total_gross)}</td>
                    <td className="px-4 py-3 text-right tnum font-semibold text-brand-700">
                      {money(inv.total_credit)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        <Link className="btn-ghost h-7 px-2 text-xs" href={`/invoice/${inv.id}?from=${encodeURIComponent(backHref)}`} onClick={() => rememberOpenedRow(inv.id)}>
                          Open
                        </Link>
                        {inv.document_file && (
                          <a
                            className="btn-ghost h-7 px-2 text-xs"
                            href={`/api/invoices/${inv.id}/document`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("records.doc")}
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!invoices.length && !loading && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-muted">
                      {t("records.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Unique items (de-para master) */}
      {tab === "items" && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Item (canonical)</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium text-right">Base rate</th>
                  <th className="px-4 py-3 font-medium text-right">Times seen</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} className="border-b border-line/70">
                    <td className="px-4 py-3 font-medium">{m.canonical_name}</td>
                    <td className="px-4 py-3">
                      {m.category_name || <span className="text-warning">Uncategorised</span>}
                    </td>
                    <td className="px-4 py-3 text-right tnum">
                      {m.expected_vat_rate === null ? "—" : `${m.expected_vat_rate}%`}
                    </td>
                    <td className="px-4 py-3 text-right tnum">{m.occurrences}</td>
                  </tr>
                ))}
                {!items.length && !loading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-muted">
                      No items yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-muted">
        {t("records.itemsFooter")}
      </p>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
