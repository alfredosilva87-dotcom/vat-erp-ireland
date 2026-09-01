"use client";

/**
 * Filiais do cliente — parte da tela de Cadastro.
 *
 * Era uma aba própria na fila das telas de trabalho diário. Filial é configuração
 * que se faz uma vez, e ocupando aquela fila empurrava para fora do campo de
 * visão as telas que se usam todo dia.
 */

import { useEffect, useState } from "react";
import type { Branch } from "@/lib/types";

export default function ClientBranches({ clientId }: { clientId: string }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const d = await (await fetch(`/api/clients/${clientId}/branches`)).json();
    setBranches(d.branches || []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);

  async function addOne() {
    if (!name.trim()) { setMsg("O nome da loja é obrigatório."); return; }
    const res = await fetch(`/api/clients/${clientId}/branches`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name, address }),
    });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error || "Erro."); return; }
    setCode(""); setName(""); setAddress(""); setMsg("Filial adicionada.");
    load();
  }
  function editRow(id: string, patch: Partial<Branch>) {
    setBranches((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  async function saveRow(b: Branch) {
    await fetch(`/api/clients/${clientId}/branches/${b.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: b.code, name: b.name, address: b.address, notes: b.notes }),
    });
    setMsg("Salvo.");
  }
  async function removeRow(id: string) {
    if (!confirm("Apagar esta filial? As notas continuam gravadas, mas perdem o vínculo com a loja.")) return;
    await fetch(`/api/clients/${clientId}/branches/${id}`, { method: "DELETE" });
    setBranches((prev) => prev.filter((b) => b.id !== id));
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold">Filiais / lojas</h2>
        <p className="mt-0.5 text-sm text-muted">
          Cadastre as lojas e a nota passa a ser vinculada a uma delas. <strong>Uma vez que existe
          filial, toda gravação exige dizer de qual é</strong> — senão a nota cai sem loja e ninguém
          percebe até o fechamento.
        </p>
      </div>

      <div className="card p-4">
        <p className="label mb-2">Nova filial</p>
        <div className="grid gap-3 sm:grid-cols-[140px_1fr_1fr_auto]">
          <input className="input" placeholder="Código (opcional)" value={code} onChange={(e) => setCode(e.target.value)} />
          <input className="input" placeholder="Nome da loja" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="Endereço (opcional)" value={address} onChange={(e) => setAddress(e.target.value)} />
          <button className="btn-primary" onClick={addOne}>Adicionar</button>
        </div>
        {msg && <p className="mt-2 text-sm text-brand-700">{msg}</p>}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <p className="p-6 text-muted">Carregando…</p>
        ) : branches.length === 0 ? (
          <p className="p-6 text-muted">Nenhuma filial ainda. Enquanto não houver, a nota é gravada sem loja.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium w-[140px]">Código</th>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Endereço</th>
                <th className="px-4 py-3 font-medium text-center w-[100px]">Ações</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id} className="border-b border-line/70">
                  <td className="px-4 py-2"><input className="input py-1 font-mono" value={b.code || ""} onChange={(e) => editRow(b.id, { code: e.target.value })} onBlur={() => saveRow(b)} /></td>
                  <td className="px-4 py-2"><input className="input py-1" value={b.name} onChange={(e) => editRow(b.id, { name: e.target.value })} onBlur={() => saveRow(b)} /></td>
                  <td className="px-4 py-2"><input className="input py-1" value={b.address || ""} onChange={(e) => editRow(b.id, { address: e.target.value })} onBlur={() => saveRow(b)} /></td>
                  <td className="px-4 py-2 text-center"><button className="chip-danger" onClick={() => removeRow(b.id)}>Apagar</button></td>
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
