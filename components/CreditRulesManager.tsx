"use client";

import { useCallback, useEffect, useState } from "react";
import type { CreditRule } from "@/lib/types";
import { ACTIVITIES } from "@/lib/activities";

const ACTS = [{ code: "*", label: "Any activity" }, ...ACTIVITIES];
const actLabel = (c: string) => ACTS.find((a) => a.code === c)?.label || c;

const emptyDraft = { activity_code: "RESTAURANT", match_keywords: "", deductible_default: true, priority: 50, rationale: "" };

export default function CreditRulesManager() {
  const [rules, setRules] = useState<CreditRule[]>([]);
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [filter, setFilter] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await (await fetch("/api/credit-rules")).json();
    setRules(d.rules || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    const body = {
      activity_code: draft.activity_code,
      match_keywords: draft.match_keywords.split(",").map((k) => k.trim()).filter(Boolean),
      deductible_default: draft.deductible_default,
      priority: Number(draft.priority) || 100,
      rationale: draft.rationale,
    };
    await fetch("/api/credit-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setDraft({ ...emptyDraft });
    setMsg("Rule added.");
    load();
  }
  async function patch(id: string, p: Partial<CreditRule>) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));
    await fetch(`/api/credit-rules/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
  }
  async function remove(id: string) {
    if (!confirm("Delete this rule?")) return;
    await fetch(`/api/credit-rules/${id}`, { method: "DELETE" });
    load();
  }

  const shown = filter ? rules.filter((r) => r.activity_code === filter) : rules;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">Credit rules</h2>
          <p className="mt-1 text-sm text-muted">
            Per company type, decide what gives input credit. Rules are matched by keyword, lowest
            priority first. The generic “Any activity” rules apply to everyone.
          </p>
        </div>
        <select className="input w-52" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All activities</option>
          {ACTS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
        </select>
      </div>

      {/* Add rule */}
      <div className="card mt-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-1">
            <label className="label">Activity</label>
            <select className="input" value={draft.activity_code} onChange={(e) => setDraft({ ...draft, activity_code: e.target.value })}>
              {ACTS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="label">Keywords (comma)</label>
            <input className="input" value={draft.match_keywords} onChange={(e) => setDraft({ ...draft, match_keywords: e.target.value })} placeholder="prawn, fish, oil" />
          </div>
          <div>
            <label className="label">Priority</label>
            <input className="input" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Credit</label>
            <select className="input" value={draft.deductible_default ? "1" : "0"} onChange={(e) => setDraft({ ...draft, deductible_default: e.target.value === "1" })}>
              <option value="1">Deductible</option>
              <option value="0">Not deductible</option>
            </select>
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full" onClick={add} disabled={!draft.match_keywords.trim()}>Add</button>
          </div>
        </div>
        <div className="mt-2">
          <input className="input" value={draft.rationale} onChange={(e) => setDraft({ ...draft, rationale: e.target.value })} placeholder="Rationale (why this is / isn't deductible)" />
        </div>
        {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
      </div>

      {/* Rules table */}
      <div className="card mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-3 font-medium">Activity</th>
                <th className="px-3 py-3 font-medium">Keywords</th>
                <th className="px-3 py-3 font-medium text-right">Priority</th>
                <th className="px-3 py-3 font-medium">Credit</th>
                <th className="px-3 py-3 font-medium">Rationale</th>
                <th className="px-3 py-3 font-medium text-center">—</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-line/70 align-middle">
                  <td className="px-3 py-2 text-xs">{actLabel(r.activity_code)}</td>
                  <td className="px-3 py-2">
                    <input
                      className="input h-9"
                      defaultValue={r.match_keywords.join(", ")}
                      onBlur={(e) => patch(r.id, { match_keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="input h-9 w-16 text-right"
                      defaultValue={r.priority}
                      onBlur={(e) => patch(r.id, { priority: Number(e.target.value) || r.priority })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select className="input h-9" value={r.deductible_default ? "1" : "0"} onChange={(e) => patch(r.id, { deductible_default: e.target.value === "1" })}>
                      <option value="1">Deductible</option>
                      <option value="0">Not deductible</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input className="input h-9" defaultValue={r.rationale || ""} onBlur={(e) => patch(r.id, { rationale: e.target.value })} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button className="btn-ghost h-8 px-3 text-xs text-danger" onClick={() => remove(r.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
