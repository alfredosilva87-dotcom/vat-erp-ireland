"use client";

import Link from "next/link";
import ClientsOverview from "@/components/ClientsOverview";
import DashboardStats from "@/components/DashboardStats";
import { useT } from "@/lib/i18n";

const rates = [
  { rate: "23%", type: "Standard", ex: "Alcohol, electronics, soft drinks, furniture, auto fuel", cls: "bg-brand-600 text-white" },
  { rate: "13.5%", type: "Reduced", ex: "Domestic fuel, construction, cleaning services", cls: "bg-brand-500 text-white" },
  { rate: "9%", type: "Second reduced", ex: "Food & catering, hairdressing (since 01 Jul 2026), newspapers", cls: "bg-brand-400 text-white" },
  { rate: "4.8%", type: "Livestock", ex: "Live cattle, sheep, horses, greyhounds", cls: "bg-warning-50 text-warning" },
  { rate: "0%", type: "Zero", ex: "Basic raw food, books, children's clothing, oral medicine", cls: "bg-surface-2 text-ink" },
  { rate: "—", type: "Exempt", ex: "Financial, medical, education (no credit)", cls: "bg-surface-2 text-muted" },
];

export default function Home() {
  const { t } = useT();
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{t("dash.title")}</h1>
          <p className="mt-1 text-muted">{t("dash.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/analyze" className="btn-primary">{t("dash.analyzeDoc")}</Link>
          <Link href="/clients" className="btn-ghost">{t("nav.clients")}</Link>
        </div>
      </div>

      <DashboardStats />

      <ClientsOverview />

      {/* Rate legend */}
      <section>
        <h2 className="font-display text-2xl font-semibold tracking-tight">{t("dash.ratesTitle")}</h2>
        <p className="mt-1 text-sm text-muted">
          Effective July 2026. The base is history-aware, so older invoices are checked against the
          rate valid on their date.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rates.map((r) => (
            <div key={r.type} className="card flex items-stretch overflow-hidden">
              <div className={`flex w-24 shrink-0 items-center justify-center font-display text-xl font-semibold tnum ${r.cls}`}>
                {r.rate}
              </div>
              <div className="p-4">
                <div className="text-sm font-semibold">{r.type}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-muted">{r.ex}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
