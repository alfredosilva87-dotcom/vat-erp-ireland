"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MasterItem } from "@/lib/types";

type Cat = { code: string | null; description: string; vat_rate: number };

export default function Items() {
  const [items, setItems] = useState<MasterItem[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/items?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    const d = await res.json();
    setItems(d.items || []);
    setDirty({});
  }, [query]);

  useEffect(() => {
    load();
    fetch("/api/base", { cache: "no-store" }).then((r) => r.json()).then((d) => setCats(d.categories || []));
  }, [load]);

  function setField(id: string, patch: Partial<MasterItem>) {
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    setDirty((d) => ({ ...d, [id]: true }));
  }
  function pickCategory(id: string, code: string) {
    const c = cats.find((x) => (x.code || "") === code);
    setField(id, {
      category_code: c?.code ?? null,
      category_name: c?.description ?? null,
      expected_vat_rate: c ? c.vat_rate : null,
    });
  }
  async function save(m: MasterItem) {
    setSavingId(m.id);
    try {
      await fetch(`/api/items/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonical_name: m.canonical_name,
          category_code: m.category_code,
          category_name: m.category_name,
          expected_vat_rate: m.expected_vat_rate,
        }),
      });
      setDirty((d) => ({ ...d, [m.id]: false }));
    } finally {
      setSavingId(null);
    }
  }
  async function remove(id: string) {
    if (!confirm("Remove this item from the catalogue? (It stays on past invoices.)")) return;
    await fetch(`/api/items/${id}`, { method: "DELETE" });
    load();
  }

  const uncategorised = useMemo(() => items.filter((m) => !m.category_code).length, [items]);
  /*
   * O CONTADOR PASSA A SER UM FILTRO.
   *
   * Dizia "12 uncategorised" numa tabela de 179 linhas e não havia forma de
   * saltar para essas 12 — era procurá-las à mão, linha a linha. Um número que
   * identifica trabalho por fazer e não leva lá é uma promessa por cumprir.
   */
  const [soSemCategoria, setSoSemCategoria] = useState(false);
  const visiveis = useMemo(
    () => (soSemCategoria ? items.filter((m) => !m.category_code) : items),
    [items, soSemCategoria]
  );

  return (
    <div className="space-y-8">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Items catalogue</h1>
          <p className="mt-1 text-muted">
            Every item ever read from invoices, de-duplicated. Edits here feed the learning cache, so
            future reads reuse your corrections — no AI call, no cost.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="chip bg-surface-2 border border-line text-muted">{items.length} items</span>
          {uncategorised > 0 && (
            <button
              type="button"
              onClick={() => setSoSemCategoria((v) => !v)}
              className={soSemCategoria ? "chip-warn ring-2 ring-warning" : "chip-warn"}
              title={soSemCategoria ? "Show every item again" : "Show only the items still to categorise"}
            >
              {uncategorised} uncategorised{soSemCategoria ? " · showing only these" : ""}
            </button>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input className="input max-w-sm" placeholder="Search items or categories…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary" type="submit">Search</button>
        {query && (
          <button type="button" className="btn-ghost" onClick={() => { setQ(""); setQuery(""); }}>Clear</button>
        )}
      </form>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-3 font-medium">Item name</th>
                <th className="px-3 py-3 font-medium">Category</th>
                <th className="px-3 py-3 font-medium text-right">Base rate %</th>
                <th className="px-3 py-3 font-medium text-right">Seen</th>
                <th className="px-3 py-3 font-medium text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((m) => (
                <tr key={m.id} className="border-b border-line/70 align-middle">
                  <td className="px-3 py-2">
                    <input className="input h-9" value={m.canonical_name} onChange={(e) => setField(m.id, { canonical_name: e.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <select className="input h-9" value={m.category_code || ""} onChange={(e) => pickCategory(m.id, e.target.value)}>
                      <option value="">— uncategorised —</option>
                      {cats.map((c) => (
                        <option key={c.code || c.description} value={c.code || ""}>{c.description} ({c.vat_rate}%)</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="input h-9 w-20 text-right"
                      value={m.expected_vat_rate ?? ""}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        setField(m.id, { expected_vat_rate: v === "" ? null : parseFloat(v.replace(",", ".")) });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 text-right tnum">{m.occurrences}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      <button
                        className="btn-primary h-8 px-3 text-xs"
                        onClick={() => save(m)}
                        disabled={!dirty[m.id] || savingId === m.id}
                      >
                        {savingId === m.id ? "…" : "Save"}
                      </button>
                      <button className="btn-ghost h-8 px-3 text-xs text-danger" onClick={() => remove(m.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted">
                    No items yet — analyze and save an invoice first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
