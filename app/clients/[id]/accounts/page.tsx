"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * O plano de contas COMO ESTE CLIENTE O VÊ.
 *
 * Duas listas, e a diferença entre elas é a coisa mais importante desta tela:
 *
 *   - as contas do ESCRITÓRIO, partilhadas pelos 35 clientes, aqui só de
 *     leitura — mudá-las é decisão de escritório e faz-se no menu geral;
 *   - as contas PRÓPRIAS deste cliente, na faixa 9000–9899, que se criam aqui
 *     porque só a ele dizem respeito.
 *
 * Antes esta tela mostrava apenas as contas com o `client_id` do cliente — que
 * é um plano que a contabilidade NÃO usa. Nos clientes de demonstração vinha
 * vazia, com zero contas, enquanto o razão trabalhava com 41. Quem abrisse
 * concluiria que o cliente não tem plano nenhum.
 *
 * Quem chega com plano próprio de outro sistema não o recria aqui: mapeia-o
 * uma vez no de-para, em Contabilidade → Contas → Abertura.
 */

type Conta = {
  id: string; code: string; description: string; type: string | null;
  report_group: string | null; active: boolean; client_id: string | null;
};

const NOME_TIPO: Record<string, string> = {
  asset: "Ativo", liability: "Passivo", equity: "Património",
  revenue: "Receita", expense: "Despesa",
};

const FAIXA = { de: "9000", ate: "9899" };

export default function PlanoDoCliente({ params }: { params: { id: string } }) {
  const [doEscritorio, setDoEscritorio] = useState<Conta[]>([]);
  const [proprias, setProprias] = useState<Conta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [nova, setNova] = useState({ code: "", description: "", type: "expense", report_group: "administrative_expenses" });

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const d = await (await fetch(`/api/clients/${params.id}/accounts`, { cache: "no-store" })).json();
      setDoEscritorio(d.ledgerAccounts || []);
      setProprias(d.accounts || []);
    } finally { setCarregando(false); }
  }, [params.id]);
  useEffect(() => { carregar(); }, [carregar]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return doEscritorio;
    return doEscritorio.filter((c) => c.code.includes(q) || c.description.toLowerCase().includes(q));
  }, [doEscritorio, busca]);

  async function criar() {
    setErro(null);
    const r = await fetch(`/api/clients/${params.id}/accounts`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nova),
    });
    const d = await r.json();
    if (!r.ok) { setErro(d.error || "Não gravou."); return; }
    setNova({ ...nova, code: "", description: "" });
    carregar();
  }

  async function apagar(id: string) {
    await fetch(`/api/clients/${params.id}/accounts/${id}`, { method: "DELETE" });
    carregar();
  }

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Plano de contas</h1>
        <p className="mt-1 text-muted">O que este cliente usa: a espinha do escritório, mais o que só ele precisa.</p>
      </div>

      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">
            Contas próprias deste cliente
          </h2>
          <span className="chip bg-surface-2 font-mono text-[11px] text-muted">{FAIXA.de}–{FAIXA.ate}</span>
        </div>
        <p className="text-sm text-muted">
          Para análise que mais nenhum cliente precisa. Fora desta faixa, a conta é do escritório.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[110px_minmax(0,1fr)_140px_auto] sm:items-end">
          <label className="flex flex-col leading-tight">
            <span className="label">Código</span>
            <input className="input w-full font-mono text-[13px]" placeholder="9010"
              value={nova.code} onChange={(e) => setNova({ ...nova, code: e.target.value })} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">Descrição</span>
            <input className="input w-full" value={nova.description}
              onChange={(e) => setNova({ ...nova, description: e.target.value })} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">Natureza</span>
            <select className="input w-full text-[13px]" value={nova.type}
              onChange={(e) => setNova({ ...nova, type: e.target.value })}>
              {Object.entries(NOME_TIPO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </label>
          <button className="btn-primary h-10 px-4 text-sm" disabled={!nova.code.trim()} onClick={criar}>
            Criar
          </button>
        </div>
        {erro && <p className="mt-2 text-sm text-danger">{erro}</p>}

        {proprias.length > 0 ? (
          <div className="-mx-1 overflow-x-auto px-1">
          <table className="mt-4 w-full text-[13px]">
            <tbody>
              {proprias.map((c) => (
                <tr key={c.id} className="border-b border-line/50">
                  <td className="py-1.5 font-mono">{c.code}</td>
                  <td className="py-1.5">{c.description}</td>
                  <td className="py-1.5 text-muted">{NOME_TIPO[c.type ?? ""] ?? "—"}</td>
                  <td className="py-1.5 text-right">
                    <button className="btn-ghost h-6 px-2 text-[11px]" onClick={() => apagar(c.id)}>remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">
            Nenhuma conta própria — este cliente usa só o plano do escritório, que é o caso normal.
          </p>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Contas do escritório</h2>
            <p className="text-sm text-muted">
              Partilhadas por todos os clientes. {/* Só de leitura aqui, de propósito. */}
              Para mudar,{" "}
              <Link href="/chart" className="text-brand-700 underline">abra o plano geral</Link>.
            </p>
          </div>
          <input className="input h-9 w-56 text-[13px]" placeholder="procurar…"
            value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="max-h-[26rem] overflow-y-auto">
          <div className="-mx-1 overflow-x-auto px-1">
          <table className="row-hover w-full text-[13px]">
            <tbody>
              {filtradas.map((c) => (
                <tr key={c.id} className={`border-b border-line/50 ${c.active ? "" : "opacity-45"}`}>
                  <td className="px-4 py-1.5 font-mono">{c.code}</td>
                  <td className="px-4 py-1.5">{c.description}</td>
                  <td className="px-4 py-1.5 text-muted">{NOME_TIPO[c.type ?? ""] ?? "—"}</td>
                  <td className="px-4 py-1.5 font-mono text-[11px] text-muted">{c.report_group ?? "—"}</td>
                </tr>
              ))}
              {carregando && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">…</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </section>

      <p className="px-1 text-xs text-muted">
        Cliente que chega com plano de outro sistema não o recria aqui: mapeia-se uma vez em{" "}
        <Link href={`/clients/${params.id}/accounting`} className="text-brand-700 underline">
          Contabilidade → Contas → Abertura
        </Link>, e daí em diante ele trabalha no plano do escritório.
      </p>
    </div>
  );
}
