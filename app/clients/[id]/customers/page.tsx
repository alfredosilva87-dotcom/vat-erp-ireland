"use client";

/**
 * Os clientes DO NOSSO CLIENTE — a quem ele emite faturas.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM CADASTRO, E NÃO UM CAMPO DE TEXTO NA FATURA
 *
 * `sales.customer` sempre foi texto livre, e chega para REGISTAR uma venda lida
 * de um documento. Não chega para EMITIR: uma fatura precisa da morada, do
 * número de VAT e do e-mail de quem a recebe, e escrever isso de novo a cada
 * fatura é onde nascem as moradas desatualizadas e os VAT numbers com um dígito
 * trocado — que depois aparecem no RTD.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Cliente = {
  id: string; name: string; vatNumber: string | null; email: string | null;
  phone: string | null; address: string | null; shipAddress: string | null;
  country: string | null; notes: string | null; active: boolean;
};

const VAZIO: Omit<Cliente, "id"> = {
  name: "", vatNumber: "", email: "", phone: "", address: "",
  shipAddress: "", country: "Ireland", notes: "", active: true,
};

export default function CustomersPage({ params }: { params: { id: string } }) {
  const [lista, setLista] = useState<Cliente[] | null>(null);
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<Partial<Cliente> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/clients/${params.id}/customers?todos=1`);
    const j = await r.json();
    setLista(j.clientes ?? []);
  }, [params.id]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function gravar() {
    if (!editando?.name?.trim()) { setErro("O nome é obrigatório."); return; }
    setGravando(true); setErro(null);
    try {
      const url = editando.id
        ? `/api/clients/${params.id}/customers/${editando.id}`
        : `/api/clients/${params.id}/customers`;
      const r = await fetch(url, {
        method: editando.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editando),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Não gravou."); return; }
      setEditando(null);
      await carregar();
    } finally { setGravando(false); }
  }

  const filtrada = (lista ?? []).filter((c) => {
    const q = busca.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.vatNumber, c.email, c.address].some((v) => v?.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Clientes</h1>
          <p className="mt-1 text-muted">
            A quem esta empresa emite faturas. Os dados daqui entram na fatura — morada, número de VAT e e-mail.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input className="input h-9 w-56" placeholder="procurar…"
            value={busca} onChange={(e) => setBusca(e.target.value)} />
          <button className="btn h-9 px-4 text-sm" onClick={() => { setEditando({ ...VAZIO }); setErro(null); }}>
            Novo cliente
          </button>
        </div>
      </div>

      {erro && !editando && <p className="text-sm text-danger">{erro}</p>}
      {aviso && <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{aviso}</p>}

      {editando && (
        <section className="card rise p-5">
          <h2 className="font-display text-sm font-semibold">
            {editando.id ? "Editar cliente" : "Novo cliente"}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <F label="Nome / razão social">
              <input className="input" value={editando.name ?? ""}
                onChange={(e) => setEditando({ ...editando, name: e.target.value })} />
            </F>
            <F label="Número de VAT">
              <input className="input font-mono" placeholder="IE1234567X"
                value={editando.vatNumber ?? ""}
                onChange={(e) => setEditando({ ...editando, vatNumber: e.target.value })} />
            </F>
            <F label="E-mail">
              <input className="input" placeholder="para onde vai a fatura"
                value={editando.email ?? ""}
                onChange={(e) => setEditando({ ...editando, email: e.target.value })} />
            </F>
            <F label="Telefone">
              <input className="input" placeholder="+353 87 123 4567"
                value={editando.phone ?? ""}
                onChange={(e) => setEditando({ ...editando, phone: e.target.value })} />
            </F>
            <F label="País">
              <input className="input" value={editando.country ?? ""}
                onChange={(e) => setEditando({ ...editando, country: e.target.value })} />
            </F>
            <div />
            {/*
              * A morada é um campo de VÁRIAS LINHAS, e não campos separados.
              *
              * Uma morada irlandesa, uma inglesa e uma portuguesa não têm a
              * mesma forma. Obrigar todas ao molde irlandês faz com que se
              * escreva a cidade no campo do condado — e é isso que sai impresso.
              */}
            <F label="Morada de faturação" largo>
              <textarea className="input min-h-[76px] py-2" rows={3}
                placeholder={"Rua e número\nLocalidade, código postal\nPaís"}
                value={editando.address ?? ""}
                onChange={(e) => setEditando({ ...editando, address: e.target.value })} />
            </F>
            <F label="Morada de entrega (só se for diferente)" largo>
              <textarea className="input min-h-[76px] py-2" rows={3}
                placeholder="deixe vazio para não sair na fatura"
                value={editando.shipAddress ?? ""}
                onChange={(e) => setEditando({ ...editando, shipAddress: e.target.value })} />
            </F>
            <F label="Observações" largo>
              <input className="input" value={editando.notes ?? ""}
                onChange={(e) => setEditando({ ...editando, notes: e.target.value })} />
            </F>
          </div>

          {erro && <p className="mt-3 text-sm text-danger">{erro}</p>}

          <div className="mt-4 flex items-center gap-3">
            <button className="btn h-9 px-4 text-sm" disabled={gravando} onClick={gravar}>
              {gravando ? "A gravar…" : "Gravar"}
            </button>
            <button className="btn-ghost h-9 px-4 text-sm" onClick={() => { setEditando(null); setErro(null); }}>
              Cancelar
            </button>
            {editando.id && (
              <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="accent-brand"
                  checked={editando.active !== false}
                  onChange={(e) => setEditando({ ...editando, active: e.target.checked })} />
                Ativo
              </label>
            )}
          </div>
        </section>
      )}

      <div className="card overflow-hidden">
        {lista === null ? (
          <p className="p-5 text-sm text-muted">A carregar…</p>
        ) : filtrada.length === 0 ? (
          <p className="p-5 text-sm text-muted">
            {busca ? "Nenhum cliente com esse texto." : "Ainda não há clientes. Crie o primeiro para poder emitir uma fatura."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 text-left font-medium">Nome</th>
                  <th className="px-3 py-2 text-left font-medium">VAT</th>
                  <th className="px-3 py-2 text-left font-medium">E-mail</th>
                  <th className="px-3 py-2 text-left font-medium">Morada</th>
                  <th className="px-3 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtrada.map((c) => (
                  <tr key={c.id} className={`border-b border-line/40 ${c.active ? "" : "opacity-55"}`}>
                    <td className="px-3 py-2">
                      {c.name}
                      {!c.active && <span className="chip ml-2 text-[10px]">inativo</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px] text-muted">{c.vatNumber || "—"}</td>
                    <td className="px-3 py-2 text-muted">{c.email || "—"}</td>
                    <td className="px-3 py-2 text-muted">
                      {(c.address || "").split("\n")[0] || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Link className="btn-ghost inline-flex h-7 items-center px-2 text-[11px]"
                        href={`/clients/${params.id}/invoices/nova?customer=${c.id}`}>
                        emitir fatura
                      </Link>
                      <button className="btn-ghost h-7 px-2 text-[11px]"
                        onClick={() => { setEditando(c); setErro(null); setAviso(null); }}>
                        editar
                      </button>
                      <button
                        className="btn-ghost h-7 px-2 text-[11px] text-danger"
                        onClick={async () => {
                          if (!confirm(`Apagar "${c.name}"?`)) return;
                          const r = await fetch(`/api/clients/${params.id}/customers/${c.id}`, { method: "DELETE" });
                          const j = await r.json().catch(() => ({}));
                          await carregar();
                          // 409 aqui NÃO é uma falha: é o cliente que tinha
                          // faturas e foi inativado em vez de apagado. Mostrar
                          // isso a vermelho faria parecer que nada aconteceu.
                          if (!r.ok) setAviso(j.error || null); else setAviso(null);
                        }}
                      >
                        apagar
                      </button>
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

function F({ label, children, largo }: { label: string; children: React.ReactNode; largo?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${largo ? "sm:col-span-2 lg:col-span-3" : ""}`}>
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}
