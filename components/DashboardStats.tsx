"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Stats = {
  invoices: number; items: number; unique_items: number; clients: number;
  needs_review: number; total_credit: number; total_gross: number;
  sales_gross: number; sales_vat: number; vat_payable: number;
};
const money = (n: number) => n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DashboardStats() {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    fetch("/api/invoices").then((r) => r.json()).then((d) => setS(d.stats));
  }, []);

  const tiles = [
    {
      label: "Faturamento (T1)", value: s ? `€ ${money(s.sales_gross)}` : "—",
      sub: s ? `VAT € ${money(s.sales_vat)}` : "", tone: "brand" as const, icon: IconTrend,
    },
    {
      label: "Compras (T2)", value: s ? `€ ${money(s.total_gross)}` : "—",
      sub: s ? `${s.invoices} nota(s)` : "", tone: "violet" as const, icon: IconDoc,
    },
    {
      label: "VAT a pagar (T3)", value: s ? `€ ${money(s.vat_payable)}` : "—",
      sub: s ? (s.vat_payable >= 0 ? "A recolher" : "A recuperar") : "",
      tone: (s && s.vat_payable < 0 ? "success" : "danger") as "success" | "danger", icon: IconReceipt,
    },
    {
      label: "Crédito de entrada", value: s ? `€ ${money(s.total_credit)}` : "—",
      sub: s ? `${s.clients} cliente(s) · ${s.unique_items} itens` : "", tone: "success" as const, icon: IconEuro,
    },
  ];
  const toneCls = {
    brand: "bg-brand-50 text-brand-700",
    violet: "bg-violet-50 text-violet",
    success: "bg-success-50 text-success",
    danger: "bg-danger-50 text-danger",
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t, i) => {
          const Icon = t.icon;
          return (
            <div key={t.label} className="card rise p-5" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted">{t.label}</div>
                  <div className="mt-1.5 font-display text-2xl font-semibold tnum">{t.value}</div>
                </div>
                <span className={`badge-soft shrink-0 ${toneCls[t.tone]}`}><Icon /></span>
              </div>
              <div className="mt-2 text-xs text-muted">{t.sub || " "}</div>
            </div>
          );
        })}
      </div>

      {!!s?.needs_review && (
        <Link
          href="/records"
          className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning-50 px-4 py-2.5 text-sm text-warning transition-colors hover:border-warning"
        >
          <strong>{s.needs_review}</strong> nota(s) com leitura de baixa confiança aguardando revisão →
        </Link>
      )}
    </div>
  );
}

function b(c: React.ReactNode) { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">{c}</svg>; }
const S = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function IconEuro() { return b(<><path d="M18 7.5A6 6 0 1 0 18 16.5" {...S} /><path d="M4 10.5h9M4 13.5h9" {...S} /></>); }
function IconDoc() { return b(<><path d="M7 3h7l4 4v14H7z" {...S} /><path d="M14 3v4h4M10 12h6M10 16h6" {...S} /></>); }
function IconTrend() { return b(<><path d="M3 17l6-6 4 4 7-7" {...S} /><path d="M20 8v5h-5" {...S} /></>); }
function IconReceipt() { return b(<><path d="M5 3v18l2.5-1.5L10 21l2-1.5L14 21l2.5-1.5L19 21V3z" {...S} /><path d="M9 8h6M9 12h6" {...S} /></>); }
