"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoredInvoice, MasterItem } from "@/lib/types";
import Link from "next/link";
import { getCurrentClient } from "@/lib/currentClient";

type Stats = { invoices: number; items: number; unique_items: number; total_credit: number };

const money = (n: number | null) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Records() {
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cp = clientId ? `&client=${clientId}` : "";
      const bp = branchId ? `&branch=${branchId}` : "";
      const url =
        tab === "items"
          ? `/api/invoices?view=items&q=${encodeURIComponent(query)}${cp}`
          : `/api/invoices?q=${encodeURIComponent(query)}${cp}${bp}`;
      const res = await fetch(url);
      const data = await res.json();
      setStats(data.stats);
      if (tab === "items") setItems(data.items || []);
      else setInvoices(data.invoices || []);
    } finally {
      setLoading(false);
    }
  }, [tab, query, clientId, branchId]);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => setClients(d.clients || []));
    const cur = getCurrentClient();
    if (cur) setClientId(cur.id);
  }, []);

  useEffect(() => {
    setBranchId("");
    if (!clientId) { setBranches([]); return; }
    fetch(`/api/clients/${clientId}/branches`).then((r) => r.json()).then((d) => setBranches(d.branches || []));
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-8">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Database</h1>
          <p className="mt-1 text-muted">All saved invoices and the de-duplicated item catalogue.</p>
        </div>
        {stats && (
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="chip bg-paper border border-line text-muted">{stats.invoices} invoices</span>
            <span className="chip bg-paper border border-line text-muted">{stats.unique_items} unique items</span>
            <span className="chip bg-brand text-white">Credit € {money(stats.total_credit)}</span>
          </div>
        )}
      </div>

      {/* Tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          {(["invoices", "items"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === t ? "bg-brand text-white" : "text-muted hover:text-ink"
              }`}
            >
              {t === "invoices" ? "Invoices" : "Unique items (de-para)"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-56" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.client_code} · {c.name}</option>
            ))}
          </select>
          {tab === "invoices" && branches.length > 0 && (
            <select className="input w-44" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">All branches</option>
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
            className="flex items-center gap-2"
          >
          <input
            className="input w-64"
            placeholder="Search supplier, item, doc no…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn-primary" type="submit">
            <SearchIcon /> Search
          </button>
          {query && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setQ("");
                setQuery("");
              }}
            >
              Clear
            </button>
          )}
          </form>
        </div>
      </div>

      {/* Invoices */}
      {tab === "invoices" && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Branch</th>
                  <th className="px-4 py-3 font-medium">Issued</th>
                  <th className="px-4 py-3 font-medium">Posting</th>
                  <th className="px-4 py-3 font-medium">Doc no.</th>
                  <th className="px-4 py-3 font-medium text-right">Items</th>
                  <th className="px-4 py-3 font-medium text-right">Gross €</th>
                  <th className="px-4 py-3 font-medium text-right">Credit €</th>
                  <th className="px-4 py-3 font-medium text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-line/70 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{inv.supplier_name || "Unknown"}</div>
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
                      <div className="flex items-center justify-center gap-1">
                        <Link className="btn-ghost h-7 px-2 text-xs" href={`/invoice/${inv.id}`}>
                          Open
                        </Link>
                        {inv.document_file && (
                          <a
                            className="btn-ghost h-7 px-2 text-xs"
                            href={`/api/invoices/${inv.id}/document`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Doc
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!invoices.length && !loading && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-muted">
                      No invoices yet. Analyze a document and click “Save to database”.
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
                <tr className="border-b border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
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
        Each distinct item name is stored once in the de-para catalogue, so repeated products never
        duplicate. “View” opens the saved original document (image or PDF).
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
