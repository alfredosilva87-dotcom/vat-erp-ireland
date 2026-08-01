"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Client, StoredInvoice } from "@/lib/types";
import { setCurrentClient } from "@/lib/currentClient";
import { downloadClientWorkbook } from "@/lib/exportXlsx";

const money = (n: number) =>
  n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Everything you can do with a client lives here, so opening a sub-screen
// never loses the client context the way the old button row did.
const TABS = [
  { seg: "", label: "Overview" },
  { seg: "sales", label: "Sales (T1)" },
  { seg: "obligations", label: "Obligations" },
  { seg: "vat", label: "VAT by rate" },
  { seg: "accounts", label: "Chart of accounts" },
  { seg: "branches", label: "Branches" },
  { seg: "bright", label: "Bright / BrightBooks" },
];

export default function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const pathname = usePathname();
  const [client, setClient] = useState<Client | null>(null);
  const [totals, setTotals] = useState({ count: 0, gross: 0, credit: 0 });
  const [active, setActive] = useState(false);

  useEffect(() => {
    (async () => {
      const c = await (await fetch(`/api/clients/${params.id}`)).json();
      setClient(c.client || null);
      const inv = await (await fetch(`/api/invoices?client=${params.id}`)).json();
      const list: StoredInvoice[] = inv.invoices || [];
      setTotals({
        count: list.length,
        gross: list.reduce((a, i) => a + (i.total_gross || 0), 0),
        credit: list.reduce((a, i) => a + (i.total_credit || 0), 0),
      });
    })();
  }, [params.id]);

  const base = `/clients/${params.id}`;
  const currentSeg = pathname === base ? "" : pathname.slice(base.length + 1).split("/")[0];

  const exportExcel = useCallback(async () => {
    const year = new Date().getFullYear();
    const data = await (await fetch(`/api/clients/${params.id}/export?year=${year}`)).json();
    downloadClientWorkbook(data);
  }, [params.id]);

  function makeActive() {
    if (!client) return;
    setCurrentClient({ id: client.id, name: client.name, activity_code: client.activity_code });
    setActive(true);
  }

  return (
    <div className="space-y-6">
      {/* Client header */}
      <div className="card rise overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 font-display text-xl font-semibold text-white shadow-brand">
              {client ? initials(client.name) : "—"}
            </span>
            <div className="min-w-0">
              <Link href="/clients" className="text-xs font-medium text-brand-700">
                ← All clients
              </Link>
              <h1 className="mt-0.5 truncate font-display text-3xl font-semibold tracking-tight">
                {client?.name ?? "Loading…"}
              </h1>
              {client && (
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                  <span className="font-mono">{client.client_code}</span>
                  <span>{client.activity_label}</span>
                  {client.vat_number && <span className="font-mono">VAT {client.vat_number}</span>}
                  {client.tax_reg_no && <span className="font-mono">TRN {client.tax_reg_no}</span>}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost h-9 px-3 text-xs" onClick={makeActive}>
              {active ? "Active ✓" : "Set as active"}
            </button>
            <button className="btn-ghost h-9 px-3 text-xs" onClick={exportExcel}>
              Export Excel
            </button>
            <button className="btn-primary h-9 px-3 text-xs" onClick={() => window.print()}>
              Export PDF
            </button>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid gap-px border-t border-line bg-line sm:grid-cols-3">
          <Stat label="Invoices" value={String(totals.count)} />
          <Stat label="Gross spend €" value={money(totals.gross)} />
          <Stat label="Input credit €" value={money(totals.credit)} accent />
        </div>

        {/* Sub-panel nav */}
        <div className="flex gap-1 overflow-x-auto border-t border-line bg-surface-2/60 p-2">
          {TABS.map((t) => {
            const href = t.seg ? `${base}/${t.seg}` : base;
            const isActive = currentSeg === t.seg;
            return (
              <Link
                key={t.seg || "overview"}
                href={href}
                className={`subnav-item ${isActive ? "subnav-item-active" : ""}`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>

      {children}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className={`font-display text-2xl font-semibold tnum ${accent ? "text-brand-700" : ""}`}>
        {value}
      </div>
      <div className="mt-0.5 text-sm text-muted">{label}</div>
    </div>
  );
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
}
