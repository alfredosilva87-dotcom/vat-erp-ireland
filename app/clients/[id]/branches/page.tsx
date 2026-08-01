"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Client, Branch } from "@/lib/types";

export default function Branches({ params }: { params: { id: string } }) {
  const [client, setClient] = useState<Client | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const c = await (await fetch(`/api/clients/${params.id}`)).json();
    setClient(c.client || null);
    const d = await (await fetch(`/api/clients/${params.id}/branches`)).json();
    setBranches(d.branches || []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [params.id]);

  async function addOne() {
    if (!name.trim()) { setMsg("Name is required."); return; }
    const res = await fetch(`/api/clients/${params.id}/branches`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name, address }),
    });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error || "Error."); return; }
    setCode(""); setName(""); setAddress(""); setMsg("Branch added.");
    load();
  }
  function editRow(id: string, patch: Partial<Branch>) {
    setBranches((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  async function saveRow(b: Branch) {
    await fetch(`/api/clients/${params.id}/branches/${b.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: b.code, name: b.name, address: b.address, notes: b.notes }),
    });
    setMsg("Saved.");
  }
  async function removeRow(id: string) {
    if (!confirm("Delete this branch? Invoices keep their record but lose the link.")) return;
    await fetch(`/api/clients/${params.id}/branches/${id}`, { method: "DELETE" });
    setBranches((prev) => prev.filter((b) => b.id !== id));
  }

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="font-display text-xl font-semibold tracking-tight">Branches / lojas</h1>
        <p className="mt-1 text-muted">Filiais de {client?.name || "this client"}. Vincule notas a cada filial e filtre por elas na Database.</p>
      </div>

      <div className="card rise p-4">
        <p className="label mb-2">Add branch</p>
        <div className="grid gap-3 sm:grid-cols-[140px_1fr_1fr_auto]">
          <input className="input" placeholder="Code (opt.)" value={code} onChange={(e) => setCode(e.target.value)} />
          <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="Address (optional)" value={address} onChange={(e) => setAddress(e.target.value)} />
          <button className="btn-primary" onClick={addOne}>Add</button>
        </div>
        {msg && <p className="mt-2 text-sm text-brand-700">{msg}</p>}
      </div>

      <div className="card overflow-hidden rise">
        {loading ? (
          <p className="p-6 text-muted">Loading…</p>
        ) : branches.length === 0 ? (
          <p className="p-6 text-muted">No branches yet. Add one above.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium w-[140px]">Code</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium text-center w-[100px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id} className="border-b border-line/70">
                  <td className="px-4 py-2"><input className="input py-1 font-mono" value={b.code || ""} onChange={(e) => editRow(b.id, { code: e.target.value })} onBlur={() => saveRow(b)} /></td>
                  <td className="px-4 py-2"><input className="input py-1" value={b.name} onChange={(e) => editRow(b.id, { name: e.target.value })} onBlur={() => saveRow(b)} /></td>
                  <td className="px-4 py-2"><input className="input py-1" value={b.address || ""} onChange={(e) => editRow(b.id, { address: e.target.value })} onBlur={() => saveRow(b)} /></td>
                  <td className="px-4 py-2 text-center"><button className="chip-danger" onClick={() => removeRow(b.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
