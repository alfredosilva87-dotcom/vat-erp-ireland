"use client";

/**
 * Contas bancárias do cliente.
 *
 * Os dois saldos aparecem lado a lado de propósito. Enquanto houver linha de
 * extrato ou lançamento sem conciliar, eles divergem — e a diferença é
 * exatamente o trabalho que falta. Esconder isso atrás de um número só é o que
 * faz o contador descobrir o problema no fechamento do mês.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { BankAccount, BankAccountBalance } from "@/lib/types";

type ContaDoPlano = { id: string; code: string; description: string; report_group: string | null };

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BankAccounts({ params }: { params: { id: string } }) {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [balances, setBalances] = useState<BankAccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({
    name: "", bank_name: "", account_ref: "", opening_balance: "", opening_date: "",
    account_code: "",
  });
  /*
   * As contas de CAIXA do plano, para escolher o portador.
   *
   * Só as de caixa: ligar um banco a uma conta de despesa passaria a creditar
   * despesa a cada pagamento, e o balanço deixaria de fechar sem ninguém
   * perceber de onde veio. Uma lista curta e certa é melhor que um campo livre
   * onde cabe qualquer coisa.
   */
  const [contasDoPlano, setContasDoPlano] = useState<ContaDoPlano[]>([]);

  const load = useCallback(async () => {
    const d = await (await fetch(`/api/clients/${params.id}/bank-accounts`, { cache: "no-store" })).json();
    setAccounts(d.accounts || []);
    setBalances(d.balances || []);
    try {
      const p = await (await fetch(`/api/clients/${params.id}/accounts`, { cache: "no-store" })).json();
      // `ledgerAccounts` e nao `accounts`: o plano do RAZAO, que e o que a
      // baixa vai creditar. Ver o comentario na rota.
      setContasDoPlano((p.ledgerAccounts || []).filter((c: ContaDoPlano) => c.report_group === "cash"));
    } catch { /* sem plano: o campo fica escondido e a baixa cai em 1100 */ }
    setLoading(false);
  }, [params.id]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.name.trim()) { setMsg("Dê um nome à conta (ex.: Conta corrente AIB)."); return; }
    const res = await fetch(`/api/clients/${params.id}/bank-accounts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        opening_balance: form.opening_balance ? Number(form.opening_balance.replace(",", ".")) : 0,
        opening_date: form.opening_date || null,
      }),
    });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error || "Erro ao criar a conta."); return; }
    setForm({ name: "", bank_name: "", account_ref: "", opening_balance: "", opening_date: "", account_code: "" });
    setMsg("Conta criada.");
    load();
  }

  const balanceOf = (id: string) => balances.find((b) => b.bank_account_id === id) || null;

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Contas bancárias</h1>
          <p className="mt-1 text-muted">
            Importe o extrato de cada conta e concilie contra as notas e vendas já lançadas.
            O saldo do extrato é o que o banco diz; o saldo no sistema é o que foi lançado aqui.
          </p>
        </div>
        <Link href={`/clients/${params.id}/bank/rules`} className="btn-ghost">Regras de banco</Link>
      </div>

      <div className="card rise p-4">
        <p className="label mb-2">Nova conta</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_160px_140px_140px_auto]">
          <input className="input" placeholder="Nome (Conta corrente AIB)" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Banco (opcional)" value={form.bank_name}
            onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
          <input className="input font-mono" placeholder="IBAN / final" value={form.account_ref}
            onChange={(e) => setForm({ ...form, account_ref: e.target.value })} />
          <input className="input text-right" placeholder="Saldo inicial" value={form.opening_balance}
            onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
          <input className="input" type="date" value={form.opening_date}
            onChange={(e) => setForm({ ...form, opening_date: e.target.value })} />
          <button className="btn-primary" onClick={add}>Criar</button>
        </div>
        {contasDoPlano.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="label mb-0">Conta do razão</span>
            <select className="input h-9 w-auto py-0 text-[13px]" value={form.account_code}
              onChange={(e) => setForm({ ...form, account_code: e.target.value })}>
              <option value="">1100 — padrão</option>
              {contasDoPlano.map((c) => (
                <option key={c.id} value={c.code}>{c.code} — {c.description}</option>
              ))}
            </select>
            <span className="text-xs text-muted">
              É a conta creditada quando se paga por aqui, e debitada quando se recebe.
            </span>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">
          O saldo inicial é o ponto de partida das duas séries. Sem ele os dois saldos não têm origem comum.
        </p>
        {msg && <p className="mt-2 text-sm text-brand-700">{msg}</p>}
      </div>

      {loading ? (
        <p className="card p-6 text-muted">Carregando…</p>
      ) : !accounts.length ? (
        <p className="card p-6 text-muted">Nenhuma conta bancária ainda. Crie a primeira acima.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {accounts.map((a) => {
            const b = balanceOf(a.id);
            const gap = b ? Number((b.statement_balance - b.system_balance).toFixed(2)) : 0;
            return (
              <Link key={a.id} href={`/clients/${params.id}/bank/${a.id}`}
                className="card rise block p-5 transition hover:border-brand-400">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-lg font-semibold">{a.name}</h2>
                    <p className="mt-0.5 text-sm text-muted">
                      {a.bank_name || "—"}
                      {a.account_ref && <span className="ml-2 font-mono text-xs">{a.account_ref}</span>}
                    </p>
                  </div>
                  {!a.active && <span className="chip">inativa</span>}
                  {a.column_mapping && <span className="chip">formato salvo</span>}
                </div>

                {/*
                  Saldo anterior + movimento, quando há fechamento travado.
                  É como se lê um extrato — e é o mesmo corte que evita
                  recalcular o histórico inteiro (ver a migração 028).
                */}
                {b?.anchor_date && (
                  <p className="mt-3 text-xs text-muted">
                    Saldo anterior em {b.anchor_date}: <b className="tnum text-ink">{money(b.anchor_balance)}</b>
                    {"  ·  "}
                    {b.movement_count_since_anchor} movimento(s) desde então:{" "}
                    <b className="tnum text-ink">{money(b.movement_since_anchor)}</b>
                  </p>
                )}

                <p className="mt-2 text-xs text-muted">
                  Conta do razão:{" "}
                  <span className="font-mono text-ink">{a.account_code || "1100"}</span>
                  {!a.account_code && " (padrão)"}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
                  <Cell label="Saldo do extrato" value={money(b?.statement_balance ?? a.opening_balance)} />
                  <Cell label="Saldo no sistema" value={money(b?.system_balance ?? a.opening_balance)} accent />
                </div>

                <p className={`mt-3 text-sm ${gap === 0 ? "text-muted" : "text-danger"}`}>
                  {gap === 0
                    ? "Sem diferença — tudo conciliado."
                    : `Diferença € ${money(gap)} · ${b?.unreconciled_statement_count ?? 0} linha(s) do extrato e ${b?.outstanding_transaction_count ?? 0} lançamento(s) por conciliar.`}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className={`font-display text-xl font-semibold tnum ${accent ? "text-brand-700" : ""}`}>€ {value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </div>
  );
}
