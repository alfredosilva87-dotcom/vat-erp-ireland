"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Client } from "@/lib/types";

type ApiStatus = { configured: boolean; status: { ok: boolean; reason: string; message: string } };

const currentYear = new Date().getFullYear();

export default function BrightPage({ params }: { params: { id: string } }) {
  const [client, setClient] = useState<Client | null>(null);
  const [year, setYear] = useState<number>(currentYear);
  const [api, setApi] = useState<ApiStatus | null>(null);

  const load = useCallback(async () => {
    const c = await (await fetch(`/api/clients/${params.id}`)).json();
    setClient(c.client || null);
    const s = await (await fetch(`/api/clients/${params.id}/bright/push`)).json();
    setApi(s);
  }, [params.id]);
  useEffect(() => { load(); }, [load]);

  const download = (type: "contacts" | "purchases" | "journal") => {
    window.location.href = `/api/clients/${params.id}/bright/export?type=${type}&year=${year}`;
  };

  const exports: Array<{ type: "contacts" | "purchases" | "journal"; title: string; desc: string }> = [
    { type: "contacts", title: "Contacts (CSV)", desc: "Suppliers from invoices + customers from sales. Import in Data Import → Contacts." },
    { type: "purchases", title: "Supplier Invoices — Detailed (CSV)", desc: "One line per item, with nominal code (chart of accounts) and VAT. Import in Data Import → Supplier Invoices." },
    { type: "journal", title: "Journal (CSV)", desc: "Double-entry lines per invoice (Dr expense + Dr VAT / Cr Accounts Payable). Import in Data Import → Journals." },
  ];

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Bright / BrightBooks</h1>
          <p className="mt-1 max-w-2xl text-muted">
            Two ways to integrate with BrightBooks (Surf Accounts): <strong>CSV export</strong>{" "}
            (works today, import inside Surf) and <strong>API connection</strong> (awaiting Bright partner access).
          </p>
        </div>
        <label className="text-sm text-muted">
          Year{" "}
          <select className="input h-9 w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Route 1 — CSV */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Route 1 · CSV export</h2>
          <span className="chip bg-emerald-100 text-emerald-800">Available</span>
        </div>
        <p className="mt-1 text-sm text-muted">
          Download the file and import it into BrightBooks under <em>Data Import</em>. Column headers are provisional
          and live in a single spot in the code (<code className="font-mono">lib/brightExport.ts → COLS</code>) — once you
          get the official Surf template, we'll match it 1:1.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {exports.map((x) => (
            <div key={x.type} className="rounded-xl border border-line p-4">
              <h3 className="font-medium">{x.title}</h3>
              <p className="mt-1 text-xs text-muted">{x.desc}</p>
              <button className="btn-primary mt-3 h-9 w-full" onClick={() => download(x.type)}>Download CSV</button>
            </div>
          ))}
        </div>
      </div>

      {/* Route 2 — API */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Route 2 · API connection</h2>
          <span className="chip bg-amber-100 text-amber-800">
            {api?.status?.ok ? "Connected" : "Unavailable"}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          {api?.status?.message ||
            "Checking connection status…"}
        </p>
        <ul className="mt-3 list-disc pl-5 text-xs text-muted">
          <li>The Surf/BrightBooks API isn't public — access is granted case by case by Bright (partner-gated).</li>
          <li>The plumbing is already in place: <code className="font-mono">BrightConnector</code> interface, Surf connector, and push routes.</li>
          <li>Once Bright grants credentials, we apply <code className="font-mono">db/bright_connections.sql</code> and implement the TODOs in <code className="font-mono">lib/brightApi.ts</code>.</li>
        </ul>
        <button className="btn-ghost mt-4 h-9" disabled title="Requires Bright partner access">
          Send via API (unavailable)
        </button>
      </div>
    </div>
  );
}
