"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { StoredInvoice, StoredItem } from "@/lib/types";
import ExportPanel from "@/components/ExportPanel";
import { useT } from "@/lib/i18n";
import { computeLines, rateOf } from "@/lib/vat";

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pad = (n: number) => String(n).padStart(2, "0");
const f = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Same view as the global Database, but locked to one client — so the
 * accountant can work a single company's purchase invoices without filtering
 * the whole database every time.
 */
export default function Purchases({ params }: { params: { id: string } }) {
  const { t } = useT();
  const [invoices, setInvoices] = useState<StoredInvoice[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string; code: string | null }[]>([]);
  const [branchId, setBranchId] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [onlyReview, setOnlyReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [itemsCache, setItemsCache] = useState<Record<string, StoredItem[]>>({});
  const [loadingItems, setLoadingItems] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ q: query, client: params.id });
      if (branchId) p.set("branch", branchId);
      if (start) p.set("start", start);
      if (end) p.set("end", end);
      if (onlyReview) p.set("review", "1");
      const d = await (await fetch(`/api/invoices?${p}`)).json();
      setInvoices(d.invoices || []);
    } finally {
      setLoading(false);
    }
  }, [params.id, query, branchId, start, end, onlyReview]);

  useEffect(() => {
    fetch(`/api/clients/${params.id}/branches`).then((r) => r.json()).then((d) => setBranches(d.branches || []));
    // Only admins may delete; the server enforces it too.
    fetch("/api/auth/me").then((r) => r.json())
      .then((d) => setCanDelete(d.user?.role === "admin" || d.user?.role === "master"))
      .catch(() => {});
  }, [params.id]);

  // A stale selection after filtering could delete rows the user can no longer see.
  useEffect(() => { setSelected(new Set()); }, [invoices]);

  useEffect(() => { load(); }, [load]);

  // Totals reflect what is on screen, so they follow the filters.
  const totals = useMemo(() => ({
    count: invoices.length,
    gross: invoices.reduce((a, i) => a + (i.total_gross || 0), 0),
    vat: invoices.reduce((a, i) => a + (i.total_vat || 0), 0),
    credit: invoices.reduce((a, i) => a + (i.total_credit || 0), 0),
    review: invoices.filter((i) => i.needs_review).length,
  }), [invoices]);

  const filtersOn = !!(start || end || onlyReview || branchId || query);
  function clearFilters() {
    setStart(""); setEnd(""); setOnlyReview(false); setBranchId(""); setQ(""); setQuery("");
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  const allSelected = invoices.length > 0 && selected.size === invoices.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(invoices.map((i) => i.id)));
  }

  async function deleteSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!confirm(t("purchases.deleteConfirm").replace("{n}", String(ids.length)))) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/invoices/bulk-delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const d = await res.json();
      if (!res.ok) { alert(d.error); return; }
      setSelected(new Set());
      await load();
    } finally {
      setDeleting(false);
    }
  }

  async function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    if (!itemsCache[id]) {
      setLoadingItems((prev) => new Set(prev).add(id));
      try {
        const d = await (await fetch(`/api/invoices/${id}`)).json();
        setItemsCache((prev) => ({ ...prev, [id]: d.items || [] }));
      } finally {
        setLoadingItems((prev) => { const n = new Set(prev); n.delete(id); return n; });
      }
    }
  }

  // Net per VAT rate present on the invoice — the reconciliation check is
  // sum(net by rate) + total VAT === total gross, so the accountant can spot
  // a mis-read document without opening it.
  function rateBreakdown(inv: StoredInvoice, items: StoredItem[]) {
    const totals = { total_net: inv.total_net, total_vat: inv.total_vat, total_gross: inv.total_gross };
    const { lines } = computeLines(items, totals);
    const byRate = new Map<number, number>();
    items.forEach((it, i) => {
      const rate = rateOf(it) ?? 0;
      byRate.set(rate, (byRate.get(rate) || 0) + lines[i].net);
    });
    const rates = Array.from(byRate.entries()).map(([rate, net]) => ({ rate, net })).sort((a, b) => b.rate - a.rate);
    const netSum = rates.reduce((a, r) => a + r.net, 0);
    const reconciled = Math.abs(netSum + (inv.total_vat || 0) - (inv.total_gross || 0)) <= Math.max(0.05, Math.abs(inv.total_gross || 0) * 0.02);
    return { rates, reconciled };
  }

  function preset(kind: "month" | "prev" | "year") {
    const n = new Date(), y = n.getFullYear(), m = n.getMonth();
    if (kind === "month") { setStart(f(new Date(y, m, 1))); setEnd(f(new Date(y, m + 1, 0))); }
    else if (kind === "prev") { setStart(f(new Date(y, m - 1, 1))); setEnd(f(new Date(y, m, 0))); }
    else { setStart(`${y}-01-01`); setEnd(`${y}-12-31`); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">{t("purchases.title")}</h2>
          <p className="text-sm text-muted">{t("purchases.subtitle")}</p>
        </div>
        <ExportPanel clientId={params.id} defaultSets={["invoices", "items"]} />
      </div>

      {/* Filters */}
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
              onClick={() => preset(k)}
            >
              {t(lbl)}
            </button>
          ))}
        </div>

        {branches.length > 0 && (
          <div>
            <label className="label">{t("records.branch")}</label>
            <select className="input h-9 w-44 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{t("records.allBranches")}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.code ? `${b.code} · ` : ""}{b.name}</option>
              ))}
            </select>
          </div>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); setQuery(q); }}
          className="flex items-end gap-2"
        >
          <div>
            <label className="label">{t("common.search")}</label>
            <input
              className="input h-9 w-56 text-sm" placeholder={t("records.searchPlaceholder")}
              value={q} onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button className="btn-primary h-9 px-3 text-xs" type="submit">{t("common.search")}</button>
        </form>

        <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)}
            className="h-3.5 w-3.5 accent-[rgb(var(--c-brand))]"
          />
          {t("records.onlyReview")}
        </label>

        {filtersOn && (
          <button className="btn-ghost ml-auto h-9 px-3 text-xs" onClick={clearFilters}>
            {t("records.clearFilters")}
          </button>
        )}
      </div>

      {/* Totals for the current filter */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t("dash.invoices")} value={String(totals.count)} />
        <Tile label={t("analyze.gross")} value={money(totals.gross)} />
        <Tile label={t("invoice.vat")} value={money(totals.vat)} />
        <Tile label={t("analyze.creditCol")} value={money(totals.credit)} accent />
      </div>

      {totals.review > 0 && (
        <p className="text-xs text-warning">
          {totals.review} {t("analyze.needReview")}
        </p>
      )}

      {canDelete && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/40 bg-brand-50 px-4 py-2.5 text-sm">
          <strong>{selected.size}</strong> {t("purchases.selectedCount")}
          <button className="btn-ghost ml-auto h-8 px-3 text-xs" onClick={() => setSelected(new Set())}>
            {t("purchases.clearSelection")}
          </button>
          <button className="btn-ghost h-8 px-3 text-xs text-danger" onClick={deleteSelected} disabled={deleting}>
            {deleting ? t("common.saving") : t("purchases.deleteSelected")}
          </button>
        </div>
      )}

      {/* Invoice table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-2 py-3" />
                {canDelete && (
                  <th className="px-3 py-3">
                    <input
                      type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="h-3.5 w-3.5 accent-[rgb(var(--c-brand))]"
                      aria-label={t("purchases.selectAll")}
                    />
                  </th>
                )}
                <th className="px-4 py-3 font-medium">{t("analyze.supplier")}</th>
                <th className="px-4 py-3 font-medium">{t("records.branch")}</th>
                <th className="px-4 py-3 font-medium">{t("analyze.issued")}</th>
                <th className="px-4 py-3 font-medium">{t("analyze.posting")}</th>
                <th className="px-4 py-3 font-medium">{t("records.docNo")}</th>
                <th className="px-4 py-3 font-medium text-right">{t("records.itemsCol")}</th>
                <th className="px-4 py-3 font-medium text-right">{t("invoice.net")}</th>
                <th className="px-4 py-3 font-medium text-right">{t("invoice.vat")}</th>
                <th className="px-4 py-3 font-medium text-right">{t("analyze.gross")}</th>
                <th className="px-4 py-3 font-medium text-right">{t("analyze.creditCol")}</th>
                <th className="px-4 py-3 font-medium text-center">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const isOpen = expanded.has(inv.id);
                const items = itemsCache[inv.id];
                const breakdown = isOpen && items ? rateBreakdown(inv, items) : null;
                return (
                  <Fragment key={inv.id}>
                    <tr className={`border-b border-line/70 align-top ${selected.has(inv.id) ? "bg-brand-50/40" : ""}`}>
                      <td className="px-2 py-3">
                        <button
                          className="text-muted transition-colors hover:text-ink"
                          onClick={() => toggleExpand(inv.id)}
                          title="Net / gross by VAT rate"
                        >
                          {isOpen ? "▾" : "▸"}
                        </button>
                      </td>
                      {canDelete && (
                        <td className="px-3 py-3">
                          <input
                            type="checkbox" checked={selected.has(inv.id)} onChange={() => toggleOne(inv.id)}
                            className="h-3.5 w-3.5 accent-[rgb(var(--c-brand))]"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{inv.supplier_name || "—"}</span>
                          {inv.needs_review && (
                            <span className="chip-warn" title={inv.review_notes?.join("; ") || t("analyze.lowConfidence")}>
                              {t("records.review")}
                            </span>
                          )}
                        </div>
                        {inv.supplier_vat && <div className="font-mono text-xs text-muted">{inv.supplier_vat}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">{inv.branch_name || "—"}</td>
                      <td className="px-4 py-3 tnum">{inv.invoice_date || "—"}</td>
                      <td className="px-4 py-3 tnum text-muted">{inv.posting_date || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{inv.invoice_number || "—"}</td>
                      <td className="px-4 py-3 text-right tnum">{inv.item_count}</td>
                      <td className="px-4 py-3 text-right tnum">{money(inv.total_net)}</td>
                      <td className="px-4 py-3 text-right tnum">{money(inv.total_vat)}</td>
                      <td className="px-4 py-3 text-right tnum">{money(inv.total_gross)}</td>
                      <td className="px-4 py-3 text-right tnum font-semibold text-brand-700">{money(inv.total_credit)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <Link className="btn-ghost h-8 px-3 text-xs" href={`/invoice/${inv.id}?from=/clients/${params.id}/purchases`}>{t("common.open")}</Link>
                          {inv.document_file && (
                            <a
                              className="btn-ghost h-8 px-3 text-xs"
                              href={`/api/invoices/${inv.id}/document`} target="_blank" rel="noreferrer"
                            >
                              {t("records.doc")}
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-line/70 bg-surface-2/40">
                        <td />
                        <td colSpan={canDelete ? 11 : 10} className="px-4 py-3">
                          {loadingItems.has(inv.id) || !breakdown ? (
                            <span className="text-xs text-muted">Loading…</span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                              <span>
                                <span className="text-muted">Gross total </span>
                                <strong className="tnum">€ {money(inv.total_gross)}</strong>
                              </span>
                              <span>
                                <span className="text-muted">VAT total </span>
                                <strong className="tnum">€ {money(inv.total_vat)}</strong>
                              </span>
                              {breakdown.rates.map((r) => (
                                <span key={r.rate}>
                                  <span className="text-muted">Net {r.rate}% </span>
                                  <strong className="tnum">€ {money(r.net)}</strong>
                                </span>
                              ))}
                              <span className={breakdown.reconciled ? "chip-ok" : "chip-warn"}>
                                {breakdown.reconciled ? "Nets + VAT = Gross" : "Nets + VAT ≠ Gross — check document"}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!invoices.length && !loading && (
                <tr>
                  <td colSpan={canDelete ? 13 : 12} className="px-4 py-10 text-center text-muted">
                    {filtersOn ? t("purchases.noneFiltered") : t("client.noInvoices")}
                  </td>
                </tr>
              )}
            </tbody>
            {invoices.length > 0 && (
              <tfoot>
                <tr className="bg-surface-2/60 font-semibold">
                  <td className="px-4 py-3" colSpan={canDelete ? 8 : 7}>{t("common.total")}</td>
                  <td className="px-4 py-3 text-right tnum">{money(totals.gross - totals.vat)}</td>
                  <td className="px-4 py-3 text-right tnum">{money(totals.vat)}</td>
                  <td className="px-4 py-3 text-right tnum">{money(totals.gross)}</td>
                  <td className="px-4 py-3 text-right tnum text-brand-700">{money(totals.credit)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card px-4 py-3">
      <div className={`font-display text-xl font-semibold tnum ${accent ? "text-brand-700" : ""}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
