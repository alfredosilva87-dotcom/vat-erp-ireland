"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/**
 * Os TIPOS DE ENCARGO — juros, taxa, multa, desconto — e a conta de cada um.
 *
 * Existe porque a conta estava escrita no código: "juros → 7100", sempre. Num
 * título a pagar estava certo; num a receber, não — juro recebido é GANHO, e a
 * partida saía a creditar uma conta de despesa. Um número escrito no código só
 * se muda com um deploy; aqui muda-se na tela.
 *
 * ---------------------------------------------------------------------------
 * DUAS CONTAS POR TIPO, E É ISSO QUE IMPORTA
 *
 * O mesmo encargo cai em contas OPOSTAS conforme o lado:
 *
 *   juro num título A PAGAR    → despesa nossa      (7100)
 *   juro num título A RECEBER  → ganho nosso        (4900)
 *   desconto obtido do fornecedor → ganho           (4900)
 *   desconto concedido ao cliente → despesa         (6990)
 *
 * A contrapartida NÃO se configura: é sempre a conta de controlo do título
 * (fornecedores ou clientes). Ela é consequência da natureza do título, não
 * escolha de ninguém.
 * ---------------------------------------------------------------------------
 */

type Tipo = {
  key: string; label: string;
  account_payable: string; account_receivable: string;
  effect: "increase" | "decrease"; sort: number; active: boolean;
};
type Conta = { code: string; description: string };

export default function TiposDeEncargo() {
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [novo, setNovo] = useState({ key: "", label: "", account_payable: "", account_receivable: "", effect: "increase" });

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [t, c] = await Promise.all([
        fetch("/api/charge-types", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/chart", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ accounts: [] })),
      ]);
      setTipos(t.types || []);
      // Só contas de RESULTADO: um encargo não nasce contra o banco nem contra
      // um ativo. Oferecer a lista inteira convidaria ao erro.
      setContas((c.accounts || []).filter((a: any) => a.type === "revenue" || a.type === "expense"));
    } finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function gravar(key: string, patch: Partial<Tipo>) {
    setErro(null); setMsg(null);
    const r = await fetch("/api/charge-types", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, ...patch }),
    });
    const d = await r.json();
    if (!r.ok) { setErro(d.error || "Não gravou."); return; }
    setMsg("Gravado — vale a partir do próximo encargo lançado.");
    carregar();
  }

  async function criar() {
    setErro(null); setMsg(null);
    const r = await fetch("/api/charge-types", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(novo),
    });
    const d = await r.json();
    if (!r.ok) { setErro(d.error || "Não gravou."); return; }
    setNovo({ key: "", label: "", account_payable: "", account_receivable: "", effect: "increase" });
    carregar();
  }

  const seletor = (valor: string, aoMudar: (v: string) => void) => (
    <select className="input h-9 w-full py-0 font-mono text-[12.5px]" value={valor}
      onChange={(e) => aoMudar(e.target.value)}>
      <option value="">—</option>
      {contas.map((c) => (
        <option key={c.code} value={c.code}>{c.code} — {c.description}</option>
      ))}
    </select>
  );

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Encargos e baixas</h1>
        <p className="mt-1 text-muted">
          Juros, taxas, multas e descontos que se lançam num título — e a conta de cada um em cada lado.
        </p>
      </div>

      <div className="card border-l-4 border-l-brand p-4 text-sm">
        O mesmo encargo cai em contas <b>opostas</b> conforme o lado: juro que você <b>paga</b> é despesa;
        juro que você <b>recebe</b> é ganho. A contrapartida — fornecedores ou clientes — não se
        configura: ela vem da natureza do título.
      </div>

      {erro && <p className="text-sm text-danger">{erro}</p>}
      {msg && <p className="text-sm text-success">{msg}</p>}

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 text-left font-medium">Tipo</th>
                <th className="px-4 py-2 text-left font-medium">Efeito</th>
                <th className="px-4 py-2 text-left font-medium">Num título A PAGAR</th>
                <th className="px-4 py-2 text-left font-medium">Num título A RECEBER</th>
                <th className="px-4 py-2 text-right font-medium">Ativo</th>
              </tr>
            </thead>
            <tbody>
              {tipos.map((t) => (
                <tr key={t.key} className={`border-b border-line/50 ${t.active ? "" : "opacity-45"}`}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{t.label}</div>
                    <div className="font-mono text-[11px] text-muted">{t.key}</div>
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {t.effect === "increase" ? "aumenta" : "abate"}
                  </td>
                  <td className="px-4 py-2">
                    {seletor(t.account_payable, (v) => gravar(t.key, { account_payable: v }))}
                  </td>
                  <td className="px-4 py-2">
                    {seletor(t.account_receivable, (v) => gravar(t.key, { account_receivable: v }))}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button className="btn-ghost h-7 px-2 text-[11px]"
                      onClick={() => gravar(t.key, { active: !t.active })}>
                      {t.active ? "desativar" : "ativar"}
                    </button>
                  </td>
                </tr>
              ))}
              {carregando && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-display text-lg font-semibold">Novo tipo</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className="flex flex-col leading-tight">
            <span className="label">Chave</span>
            <input className="input w-full font-mono text-[13px]" placeholder="cambio"
              value={novo.key} onChange={(e) => setNovo({ ...novo, key: e.target.value })} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">Nome</span>
            <input className="input w-full" value={novo.label}
              onChange={(e) => setNovo({ ...novo, label: e.target.value })} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">Conta — a pagar</span>
            {seletor(novo.account_payable, (v) => setNovo({ ...novo, account_payable: v }))}
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">Conta — a receber</span>
            {seletor(novo.account_receivable, (v) => setNovo({ ...novo, account_receivable: v }))}
          </label>
          <button className="btn-primary h-10 px-5 text-sm"
            disabled={!novo.key.trim() || !novo.account_payable || !novo.account_receivable}
            onClick={criar}>Criar</button>
        </div>
        <p className="mt-2 text-xs text-muted">
          As contas saem do{" "}
          <Link href="/chart" className="text-brand-700 underline">plano do escritório</Link> —
          só as de resultado, porque um encargo não nasce contra o banco.
        </p>
      </section>
    </div>
  );
}
