"use client";

import { useEffect, useState } from "react";

type Stats = {
  invoices: number; items: number; unique_items: number;
  clients: number; total_credit: number; total_gross: number;
};
const money = (n: number) => n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DashboardStats() {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    fetch("/api/invoices").then((r) => r.json()).then((d) => setS(d.stats));
  }, []);

  const tiles = [
    { label: "Input credit (total)", value: s ? `€ ${money(s.total_credit)}` : "—", tone: "brand", icon: IconEuro },
    { label: "Invoices processed", value: s ? String(s.invoices) : "—", tone: "info", icon: IconDoc },
    { label: "Clients", value: s ? String(s.clients) : "—", tone: "warn", icon: IconUsers },
    { label: "Items catalogue", value: s ? String(s.unique_items) : "—", tone: "ok", icon: IconTag },
  ];
  const toneCls: Record<string, string> = {
    brand: "bg-ok-50 text-brand-700",
    info: "bg-info-50 text-info",
    warn: "bg-warning-50 text-warning",
    ok: "bg-ok-50 text-brand-700",
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t, i) => {
        const Icon = t.icon;
        return (
          <div key={t.label} className="card rise p-5" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="flex items-start justify-between">
              <div className={`badge-soft ${toneCls[t.tone]}`}><Icon /></div>
            </div>
            <div className="mt-4 font-display text-2xl font-semibold tnum">{t.value}</div>
            <div className="mt-0.5 text-sm text-muted">{t.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function b(c: React.ReactNode) { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">{c}</svg>; }
const S = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function IconEuro() { return b(<><path d="M18 7.5A6 6 0 1 0 18 16.5" {...S} /><path d="M4 10.5h9M4 13.5h9" {...S} /></>); }
function IconDoc() { return b(<><path d="M7 3h7l4 4v14H7z" {...S} /><path d="M14 3v4h4M10 12h6M10 16h6" {...S} /></>); }
function IconUsers() { return b(<><circle cx="9" cy="8" r="3.2" {...S} /><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 20a5.5 5.5 0 0 0-2-4.3" {...S} /></>); }
function IconTag() { return b(<><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" {...S} /><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none" /></>); }
