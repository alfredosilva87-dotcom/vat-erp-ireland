"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import type { Client, ChartAccount } from "@/lib/types";

export default function ChartOfAccounts({ params }: { params: { id: string } }) {
  const [client, setClient] = useState<Client | null>(null);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [code, setCode] = useState("");
  const [desc, setDesc] = useState("");
  const [parent, setParent] = useState("");
  const [msg, setMsg] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const c = await (await fetch(`/api/clients/${params.id}`)).json();
    setClient(c.client || null);
    const d = await (await fetch(`/api/clients/${params.id}/accounts`)).json();
    setAccounts(d.accounts || []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [params.id]);

  async function addOne() {
    if (!code.trim()) return;
    const res = await fetch(`/api/clients/${params.id}/accounts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, description: desc, parent_code: parent || null }),
    });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error || "Error."); return; }
    setCode(""); setDesc(""); setParent(""); setMsg("Account added.");
    load();
  }

  async function saveRow(a: ChartAccount) {
    await fetch(`/api/clients/${params.id}/accounts/${a.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: a.code, description: a.description, parent_code: a.parent_code, active: a.active }),
    });
    setMsg("Saved.");
  }
  async function removeRow(id: string) {
    if (!confirm("Delete this account?")) return;
    await fetch(`/api/clients/${params.id}/accounts/${id}`, { method: "DELETE" });
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }
  function editRow(id: string, patch: Partial<ChartAccount>) {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  async function onFile(file: File) {
    setImporting(true); setMsg("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const rows = raw.map((r) => {
        const keys = Object.keys(r);
        const pick = (...names: string[]) => {
          const k = keys.find((kk) => names.some((n) => kk.toLowerCase().trim().includes(n)));
          return k ? String(r[k]).trim() : "";
        };
        return {
          code: pick("codigo", "código", "code", "conta", "account", "nº", "no"),
          description: pick("descri", "description", "nome", "name", "title"),
          parent_code: pick("pai", "parent", "superior", "grupo"),
        };
      }).filter((r) => r.code);
      if (!rows.length) { setMsg("No rows with a code column were found."); setImporting(false); return; }
      const res = await fetch(`/api/clients/${params.id}/accounts`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }),
      });
      const d = await res.json();
      setMsg(`${d.imported ?? 0} accounts imported.`);
      load();
    } catch (e: any) {
      setMsg("Could not read the file: " + (e?.message || "unknown error"));
    }
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  const shown = accounts.filter((a) =>
    !q || `${a.code} ${a.description}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Chart of accounts</h1>
          <p className="mt-1 text-muted">Plano de contas de {client?.name || "this client"}. Import from Excel or add accounts manually.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? "Importing…" : "Import Excel / CSV"}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => e.target.files && e.target.files[0] && onFile(e.target.files[0])} />
        </div>
      </div>

      <div className="card rise p-4">
        <p className="label mb-2">Add account</p>
        <div className="grid gap-3 sm:grid-cols-[140px_1fr_140px_auto]">
          <input className="input" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
          <input className="input" placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <input className="input" placeholder="Parent (optional)" value={parent} onChange={(e) => setParent(e.target.value)} />
          <button className="btn-primary" onClick={addOne}>Add</button>
        </div>
        <p className="mt-2 text-xs text-muted">Excel columns are auto-detected: code/código/conta, description/descrição/nome, parent/pai (optional).</p>
        {msg && <p className="mt-2 text-sm text-brand-700">{msg}</p>}
      </div>

      <div className="card overflow-hidden rise">
        <div className="flex items-center justify-between gap-3 border-b border-line p-3">
          <input className="input max-w-xs" placeholder="Search code or description…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="text-sm text-muted">{shown.length} of {accounts.length}</span>
        </div>
        {loading ? (
          <p className="p-6 text-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="p-6 text-muted">No accounts yet. Import an Excel file or add one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium w-[140px]">Code</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium w-[140px]">Parent</th>
                  <th className="px-4 py-3 font-medium text-center w-[120px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.id} className="border-b border-line/70">
                    <td className="px-4 py-2"><input className="input py-1 font-mono" value={a.code} onChange={(e) => editRow(a.id, { code: e.target.value })} onBlur={() => saveRow(a)} /></td>
                    <td className="px-4 py-2"><input className="input py-1" value={a.description} onChange={(e) => editRow(a.id, { description: e.target.value })} onBlur={() => saveRow(a)} /></td>
                    <td className="px-4 py-2"><input className="input py-1 font-mono" value={a.parent_code || ""} onChange={(e) => editRow(a.id, { parent_code: e.target.value })} onBlur={() => saveRow(a)} /></td>
                    <td className="px-4 py-2 text-center">
                      <button className="chip-danger" onClick={() => removeRow(a.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
