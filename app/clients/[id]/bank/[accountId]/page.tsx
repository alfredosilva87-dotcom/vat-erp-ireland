"use client";

/**
 * Uma conta bancária: importar extrato, ver as linhas e desfazer um lote.
 *
 * As linhas do extrato não são editáveis — é o que o banco disse. O que vai
 * acontecer com elas (casar com nota, virar lançamento avulso) é a camada A2.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import StatementImport from "@/components/StatementImport";
import type { BankAccount, BankAccountBalance, BankImport, StoredStatementLine } from "@/lib/types";

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_LABEL: Record<string, string> = {
  unreconciled: "por conciliar", reconciled: "conciliada", ignored: "ignorada",
};

export default function BankAccountDetail({
  params,
}: {
  params: { id: string; accountId: string };
}) {
  const [account, setAccount] = useState<BankAccount | null>(null);
  const [balance, setBalance] = useState<BankAccountBalance | null>(null);
  const [lines, setLines] = useState<StoredStatementLine[]>([]);
  const [imports, setImports] = useState<BankImport[]>([]);
  const [loading, setLoading] = useState(true);
  // Uma recusa não pode aparecer com a cara de confirmação: "o lote já foi
  // conciliado" pintado de sucesso é lido como "desfeito" e a pessoa segue em
  // frente achando que removeu o que continua lá.
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [notFound, setNotFound] = useState(false);

  const base = `/api/clients/${params.id}/bank-accounts/${params.accountId}`;

  const load = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" });
    if (!res.ok) { setNotFound(true); setLoading(false); return; }
    const d = await res.json();
    setAccount(d.account); setBalance(d.balance);
    setLines(d.lines || []); setImports(d.imports || []);
    setLoading(false);
  }, [base]);
  useEffect(() => { load(); }, [load]);

  async function undoImport(imp: BankImport) {
    if (!confirm(`Desfazer a importação de "${imp.filename || "sem nome"}" (${imp.line_count} linhas)?`)) return;
    const res = await fetch(`${base}/imports/${imp.id}`, { method: "DELETE" });
    const d = await res.json();
    setMsg(res.ok
      ? { text: `${d.removed} linha(s) removida(s).` }
      : { text: d.error || "Não foi possível desfazer.", error: true });
    load();
  }

  if (notFound) {
    return (
      <div className="card p-6">
        <p className="text-muted">Conta não encontrada.</p>
        <Link href={`/clients/${params.id}/bank`} className="btn-ghost mt-3 inline-block">Voltar às contas</Link>
      </div>
    );
  }
  if (loading || !account) return <p className="card p-6 text-muted">Carregando…</p>;

  const gap = balance ? Number((balance.statement_balance - balance.system_balance).toFixed(2)) : 0;

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/clients/${params.id}/bank`} className="text-xs font-medium text-brand-700">
            ← Contas bancárias
          </Link>
          <h1 className="mt-0.5 font-display text-xl font-semibold tracking-tight">{account.name}</h1>
          <p className="mt-1 text-muted">
            {account.bank_name || "—"}
            {account.account_ref && <span className="ml-2 font-mono text-xs">{account.account_ref}</span>}
            <span className="ml-2">· saldo inicial € {money(account.opening_balance)}</span>
            {account.opening_date && <span className="ml-1">em {account.opening_date}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/clients/${params.id}/bank/${params.accountId}/closing`} className="btn-ghost">
            Fechamento
          </Link>
          <Link href={`/clients/${params.id}/bank/${params.accountId}/reconcile`} className="btn-primary">
            Conciliar
            {!!balance?.unreconciled_statement_count && ` (${balance.unreconciled_statement_count})`}
          </Link>
        </div>
      </div>

      <div className="card grid gap-px overflow-hidden bg-line sm:grid-cols-4">
        <Stat label="Saldo do extrato" value={`€ ${money(balance?.statement_balance ?? account.opening_balance)}`} />
        <Stat label="Saldo no sistema" value={`€ ${money(balance?.system_balance ?? account.opening_balance)}`} accent />
        <Stat label="Diferença" value={`€ ${money(gap)}`} danger={gap !== 0} />
        <Stat label="Linhas por conciliar" value={String(balance?.unreconciled_statement_count ?? 0)} />
      </div>

      <StatementImport
        clientId={params.id}
        accountId={params.accountId}
        savedMapping={account.column_mapping}
        onImported={(m) => { setMsg({ text: m }); load(); }}
      />

      {msg && (
        <p className={msg.error
          ? "rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
          : "text-sm text-brand-700"}>
          {msg.error ? "⚠ " : ""}{msg.text}
        </p>
      )}

      {!!imports.length && (
        <div className="card overflow-hidden">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-display text-lg font-semibold">Importações</h2>
            <p className="mt-0.5 text-sm text-muted">
              Desfazer só é possível enquanto nenhuma linha do lote tiver sido conciliada.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Quando</th>
                <th className="px-4 py-2 font-medium">Arquivo</th>
                <th className="px-4 py-2 font-medium text-right">Importadas</th>
                <th className="px-4 py-2 font-medium text-right">Ignoradas</th>
                <th className="px-4 py-2 font-medium text-center">—</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.id} className="border-b border-line/70">
                  <td className="px-4 py-2 tnum">{new Date(i.created_at).toLocaleString("en-IE")}</td>
                  <td className="px-4 py-2"><span className="font-mono text-xs">{i.filename || "—"}</span></td>
                  <td className="px-4 py-2 text-right tnum">{i.line_count}</td>
                  <td className="px-4 py-2 text-right tnum text-muted">{i.skipped_count}</td>
                  <td className="px-4 py-2 text-center">
                    <button className="btn-ghost h-8 px-3 text-xs text-danger" onClick={() => undoImport(i)}>
                      Desfazer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-display text-lg font-semibold">Linhas do extrato</h2>
          <p className="mt-0.5 text-sm text-muted">
            O que o banco informou. Não são editáveis — a conciliação com notas e vendas vem na próxima camada.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Data</th>
                <th className="px-4 py-2 font-medium">Descrição</th>
                <th className="px-4 py-2 font-medium">Referência</th>
                <th className="px-4 py-2 font-medium text-right">Valor €</th>
                <th className="px-4 py-2 font-medium text-right">Saldo €</th>
                <th className="px-4 py-2 font-medium text-center">Situação</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-line/70">
                  <td className="px-4 py-2 tnum">{l.line_date}</td>
                  <td className="px-4 py-2">{l.description || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">{l.reference || "—"}</td>
                  <td className={`px-4 py-2 text-right tnum font-medium ${l.amount < 0 ? "text-danger" : "text-brand-700"}`}>
                    {money(l.amount)}
                  </td>
                  <td className="px-4 py-2 text-right tnum text-muted">{money(l.balance)}</td>
                  <td className="px-4 py-2 text-center">
                    <span className="chip text-xs">{STATUS_LABEL[l.status] || l.status}</span>
                  </td>
                </tr>
              ))}
              {!lines.length && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">
                  Nenhuma linha ainda. Importe um extrato acima.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent, danger }: {
  label: string; value: string; accent?: boolean; danger?: boolean;
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className={`font-display text-2xl font-semibold tnum ${danger ? "text-danger" : accent ? "text-brand-700" : ""}`}>
        {value}
      </div>
      <div className="mt-0.5 text-sm text-muted">{label}</div>
    </div>
  );
}
