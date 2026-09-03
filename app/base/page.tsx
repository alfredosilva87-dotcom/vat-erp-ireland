"use client";

import { useEffect, useMemo, useState } from "react";
import CreditRulesManager from "@/components/CreditRulesManager";
import type { VatCategory, CreditRule, VatRateType } from "@/lib/types";

const RATE_TYPES: { value: VatRateType; label: string; rate: number }[] = [
  { value: "standard", label: "Standard 23%", rate: 23 },
  { value: "reduced", label: "Reduced 13.5%", rate: 13.5 },
  { value: "second_reduced", label: "Second reduced 9%", rate: 9 },
  { value: "livestock", label: "Livestock 4.8%", rate: 4.8 },
  { value: "zero", label: "Zero 0%", rate: 0 },
  { value: "exempt", label: "Exempt", rate: 0 },
];

const emptyDraft = {
  code: "",
  description: "",
  keywords: "",
  rate_type: "standard" as VatRateType,
  vat_rate: 23,
  effective_from: "2000-01-01",
};

export default function BasePage() {
  const [categories, setCategories] = useState<VatCategory[]>([]);
  const [rules, setRules] = useState<CreditRule[]>([]);
  const [source, setSource] = useState<"supabase" | "bundled">("bundled");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const editable = source === "supabase";

  async function load() {
    const res = await fetch("/api/base", { cache: "no-store" });
    const data = await res.json();
    setCategories(data.categories || []);
    setRules(data.rules || []);
    setSource(data.source);
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return categories.filter(
      (c) =>
        !s ||
        c.description.toLowerCase().includes(s) ||
        (c.code || "").toLowerCase().includes(s) ||
        c.keywords.some((k) => k.toLowerCase().includes(s))
    );
  }, [categories, q]);

  async function addCategory() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/base/category", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: draft.code || null,
          description: draft.description,
          keywords: draft.keywords.split(",").map((k) => k.trim()).filter(Boolean),
          vat_rate: draft.vat_rate,
          rate_type: draft.rate_type,
          effective_from: draft.effective_from,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDraft({ ...emptyDraft });
      setMsg("Category saved.");
      load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="rise">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Rate base</h1>
        <p className="mt-1 text-muted">
          The VAT rate catalogue that drives the checks. Maintained by the accountant — Revenue does
          not publish a downloadable database, so rates are kept current here.
        </p>
      </div>

      {source === "bundled" && (
        <div className="card rise flex items-start gap-3 border-warning/30 bg-warning-50 p-4 text-sm">
          <span className="mt-0.5 text-warning">
            <InfoIcon />
          </span>
          <div>
            <strong>Read-only (bundled base).</strong> You are viewing the built-in seed. To edit and
            persist rates, configure Supabase in <code className="font-mono">.env.local</code> and
            apply <code className="font-mono">db/schema.sql</code> + the seed files.
          </div>
        </div>
      )}

      {/* Add category */}
      {editable && (
        <div className="card rise p-5">
          <h2 className="font-display text-lg font-semibold">Add a category</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label className="label">Description</label>
              <input
                className="input"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="e.g. Restaurant / catering services"
              />
            </div>
            <div>
              <label className="label">Rate</label>
              <select
                className="input"
                value={draft.rate_type}
                onChange={(e) => {
                  const rt = RATE_TYPES.find((r) => r.value === e.target.value)!;
                  setDraft({ ...draft, rate_type: rt.value, vat_rate: rt.rate });
                }}
              >
                {RATE_TYPES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Effective from</label>
              <input
                type="date"
                className="input"
                value={draft.effective_from}
                onChange={(e) => setDraft({ ...draft, effective_from: e.target.value })}
              />
            </div>
            <div className="lg:col-span-4">
              <label className="label">Keywords (comma-separated, used for item matching)</label>
              <input
                className="input"
                value={draft.keywords}
                onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
                placeholder="restaurant, catering, hot food, takeaway"
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={addCategory} disabled={saving || !draft.description}>
              {saving ? "Saving…" : "Add category"}
            </button>
            {msg && <span className="text-sm text-muted">{msg}</span>}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center justify-between gap-3">
        <input
          className="input max-w-sm"
          placeholder="Search categories or keywords…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-sm text-muted">{filtered.length} categories</span>
      </div>

      {/* Categories table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Keywords</th>
                <th className="px-4 py-3 font-medium text-right">Rate</th>
                <th className="px-4 py-3 font-medium">Effective</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-line/70 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.description}</div>
                    {c.code && <div className="text-xs text-muted font-mono">{c.code}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.keywords.slice(0, 8).map((k) => (
                        <span key={k} className="chip bg-surface-2 border border-line text-muted">
                          {k}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="tnum font-semibold">{c.vat_rate}%</span>
                    <div className="text-xs text-muted">{c.rate_type.replace("_", " ")}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted tnum">
                    {c.effective_from}
                    {c.effective_to ? ` → ${c.effective_to}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CreditRulesManager />

    </div>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11v5M12 8h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
