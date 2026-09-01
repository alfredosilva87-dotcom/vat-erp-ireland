"use client";

/**
 * Fechamento e relatório de conciliação (camada A5).
 *
 * É a tela que o escritório mostra para provar que o mês fecha. Ela é escrita
 * de cima para baixo como uma conta que alguém confere no papel: começa no
 * saldo inicial, soma o que o extrato trouxe, e termina no saldo que o contador
 * leu no extrato impresso.
 *
 * O número que importa é o último: **a diferença**. Zero significa que tudo que
 * o banco disse que aconteceu está aqui dentro.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { BankAccount } from "@/lib/types";
import type { ClosingLine, ClosingReport, ClosingTxn } from "@/lib/closingReport";

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface StoredClosing {
  id: string; period_end: string; statement_balance: number; reported_balance: number | null;
  difference: number | null; unreconciled_lines_count: number; outstanding_txn_count: number;
  note: string | null; locked: boolean; created_at: string;
}

const hoje = () => new Date().toISOString().slice(0, 10);

export default function Closing({ params }: { params: { id: string; accountId: string } }) {
  const [account, setAccount] = useState<BankAccount | null>(null);
  const [report, setReport] = useState<ClosingReport | null>(null);
  const [duplicates, setDuplicates] = useState<Array<[ClosingLine, ClosingLine]>>([]);
  const [history, setHistory] = useState<StoredClosing[]>([]);
  const [lockedThrough, setLockedThrough] = useState<string | null>(null);
  const [existing, setExisting] = useState<StoredClosing | null>(null);

  const [asOf, setAsOf] = useState(hoje());
  const [reported, setReported] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const base = `/api/clients/${params.id}/bank-accounts/${params.accountId}`;

  const load = useCallback(async () => {
    const url = `${base}/closing?asOf=${asOf}${reported.trim() ? `&saldo=${encodeURIComponent(reported)}` : ""}`;
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const d = await res.json();
      setAccount(d.account); setReport(d.report); setDuplicates(d.duplicates || []);
      setHistory(d.history || []); setLockedThrough(d.lockedThrough ?? null);
      setExisting(d.existing ?? null);
    }
    setLoading(false);
  }, [base, asOf, reported]);

  // Recalcula enquanto o contador digita o saldo do papel: é o número que ele
  // está conferindo, e esperar por um botão só atrasa a resposta.
  useEffect(() => {
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
  }, [load]);

  async function fechar() {
    setBusy(true);
    try {
      const res = await fetch(`${base}/closing`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asOf, reportedBalance: reported || null, note }),
      });
      const d = await res.json();
      setMsg(res.ok
        ? { text: `Período fechado até ${asOf}. Conciliação neste intervalo passa a exigir reabertura.` }
        : { text: d.error || "Não foi possível fechar.", error: true });
      await load();
    } finally { setBusy(false); }
  }

  async function reabrir(c: StoredClosing) {
    if (!confirm(`Reabrir o fechamento de ${c.period_end}? O registro da conferência daquele dia é apagado.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${base}/closing/${c.id}`, { method: "DELETE" });
      const d = await res.json();
      setMsg(res.ok ? { text: "Período reaberto." } : { text: d.error || "Não foi possível reabrir.", error: true });
      await load();
    } finally { setBusy(false); }
  }

  if (loading) return <p className="card p-6 text-muted">Carregando…</p>;
  if (!report || !account) return <p className="card p-6 text-muted">Conta não encontrada.</p>;

  const diff = report.difference;

  return (
    <div className="space-y-6">
      <div className="rise">
        <Link href={`/clients/${params.id}/bank/${params.accountId}`} className="text-xs font-medium text-brand-700">
          ← {account.name}
        </Link>
        <h1 className="mt-0.5 font-display text-xl font-semibold tracking-tight">Fechamento do período</h1>
        <p className="mt-1 text-muted">
          Confere o que o banco disse contra o que foi lançado aqui, e termina no saldo que você lê no
          extrato impresso. Diferença zero significa que o extrato inteiro entrou.
        </p>
      </div>

      <div className="card rise grid gap-3 p-4 sm:grid-cols-[200px_220px_1fr]">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Fechar até</span>
          <input type="date" className="input h-9" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Saldo final no extrato de papel</span>
          <input className="input h-9 text-right" placeholder="ex.: 4557,70"
            value={reported} onChange={(e) => setReported(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Observação (opcional)</span>
          <input className="input h-9" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      {lockedThrough && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
          🔒 Período fechado até <strong>{lockedThrough}</strong>. Conciliar, desconciliar ou importar
          dentro dele exige reabrir o fechamento.
        </p>
      )}
      {msg && (
        <p className={msg.error
          ? "rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
          : "text-sm text-brand-700"}>{msg.error ? "⚠ " : ""}{msg.text}</p>
      )}

      {/* A conta, de cima para baixo */}
      <div className="card overflow-hidden">
        <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full text-sm">
          <tbody>
            <Row label="Saldo inicial da conta" value={report.openingBalance} />
            <Row label="Movimentos do extrato até a data" value={report.statementBalance - report.openingBalance} />
            <Row label="Saldo do extrato calculado" value={report.statementBalance} strong />
            <tr><td colSpan={2} className="px-4 py-1"></td></tr>
            <Row label="Saldo no sistema (o que foi lançado)" value={report.systemBalance} />
            <Row label={`Linhas do extrato ainda não conciliadas (${report.unreconciled.count})`}
              value={report.unreconciled.total} muted />
            <Row label={`Lançamentos sem linha no extrato (${report.outstanding.count})`}
              value={report.outstanding.total} muted />
            {report.ignored.count > 0 && (
              <Row label={`Linhas ignoradas (${report.ignored.count}) — fora do saldo`}
                value={report.ignored.total} muted />
            )}
            <tr className="border-t border-line">
              <td className="px-4 py-3">Saldo final informado por você</td>
              <td className="px-4 py-3 text-right tnum">
                {report.reportedBalance === null
                  ? <span className="text-muted">— digite acima —</span>
                  : `€ ${money(report.reportedBalance)}`}
              </td>
            </tr>
            <tr className={`border-t-2 border-line ${diff !== null && Math.abs(diff) > 0.01 ? "bg-danger/5" : ""}`}>
              <td className="px-4 py-3 font-medium">Diferença</td>
              <td className={`px-4 py-3 text-right font-display text-xl font-semibold tnum ${
                diff === null ? "text-muted" : Math.abs(diff) <= 0.01 ? "text-brand-700" : "text-danger"}`}>
                {diff === null ? "—" : `€ ${money(diff)}`}
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      {!!report.notes.length && (
        <div className="card p-4">
          <p className="label mb-2">O que explica a diferença</p>
          <ul className="space-y-1 text-sm text-muted">
            {report.notes.map((n, i) => <li key={i}>· {n}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={fechar} disabled={busy || !report.closable}>
          {existing ? "Refazer o fechamento desta data" : "Fechar período"}
        </button>
        {!report.closable && (
          <span className="text-sm text-muted">
            Só dá para fechar quando a diferença contra o saldo informado é zero.
          </span>
        )}
      </div>

      {/* Exceções */}
      {(report.unreconciled.count > 0 || duplicates.length > 0) && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Exceções</h2>

          {!!duplicates.length && (
            <div className="card overflow-hidden">
              <p className="border-b border-line px-4 py-2 text-sm text-muted">
                Possíveis duplicatas — mesma data, mesmo valor e descrição parecida. Dois cafés iguais
                no mesmo dia também são legítimos, então isto é só um aviso.
              </p>
              <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full text-sm">
                <tbody>
                  {duplicates.slice(0, 20).map(([a, b], i) => (
                    <tr key={i} className="border-b border-line/70">
                      <td className="px-4 py-2 tnum">{a.line_date}</td>
                      <td className="px-4 py-2">{a.description || "—"} <span className="text-muted">/</span> {b.description || "—"}</td>
                      <td className="px-4 py-2 text-right tnum">{money(a.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {!!report.unreconciled.count && (
            <div className="card overflow-hidden">
              <p className="border-b border-line px-4 py-2 text-sm text-muted">
                Linhas do extrato ainda não conciliadas até {asOf}.
              </p>
              <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full text-sm">
                <tbody>
                  {report.unreconciled.lines.slice(0, 30).map((l: ClosingLine) => (
                    <tr key={l.id} className="border-b border-line/70">
                      <td className="px-4 py-2 tnum">{l.line_date}</td>
                      <td className="px-4 py-2">{l.description || "—"}</td>
                      <td className={`px-4 py-2 text-right tnum ${l.amount < 0 ? "text-danger" : "text-brand-700"}`}>
                        {money(l.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </section>
      )}

      {!!report.outstanding.count && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Lançados aqui, ainda não vistos no banco</h2>
          <p className="-mt-2 text-sm text-muted">
            Cheque não compensado, pagamento em trânsito. É pendência legítima e não impede fechar.
          </p>
          <div className="card overflow-hidden">
            <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full text-sm">
              <tbody>
                {report.outstanding.transactions.slice(0, 30).map((t: ClosingTxn) => (
                  <tr key={t.id} className="border-b border-line/70">
                    <td className="px-4 py-2 tnum">{t.txn_date}</td>
                    <td className="px-4 py-2">{t.description || "—"}</td>
                    <td className={`px-4 py-2 text-right tnum ${t.amount < 0 ? "text-danger" : "text-brand-700"}`}>
                      {money(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </section>
      )}

      {!!history.length && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Fechamentos anteriores</h2>
          <div className="card overflow-hidden">
            <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Até</th>
                  <th className="px-4 py-2 font-medium text-right">Extrato €</th>
                  <th className="px-4 py-2 font-medium text-right">Informado €</th>
                  <th className="px-4 py-2 font-medium text-right">Diferença</th>
                  <th className="px-4 py-2 font-medium">Pendências no dia</th>
                  <th className="px-4 py-2 font-medium text-center">—</th>
                </tr>
              </thead>
              <tbody>
                {history.map((c) => (
                  <tr key={c.id} className="border-b border-line/70">
                    <td className="px-4 py-2 tnum">{c.period_end} {c.locked && "🔒"}</td>
                    <td className="px-4 py-2 text-right tnum">{money(c.statement_balance)}</td>
                    <td className="px-4 py-2 text-right tnum">{money(c.reported_balance)}</td>
                    <td className="px-4 py-2 text-right tnum">{money(c.difference)}</td>
                    <td className="px-4 py-2 text-xs text-muted">
                      {c.unreconciled_lines_count} linha(s), {c.outstanding_txn_count} lançamento(s)
                    </td>
                    <td className="px-4 py-2 text-center">
                      <button className="btn-ghost h-8 px-3 text-xs text-danger" disabled={busy}
                        onClick={() => reabrir(c)}>Reabrir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Row({ label, value, strong, muted }: {
  label: string; value: number; strong?: boolean; muted?: boolean;
}) {
  return (
    <tr className="border-b border-line/70">
      <td className={`px-4 py-2 ${muted ? "text-muted" : ""}`}>{label}</td>
      <td className={`px-4 py-2 text-right tnum ${strong ? "font-display text-lg font-semibold" : ""} ${muted ? "text-muted" : ""}`}>
        € {money(value)}
      </td>
    </tr>
  );
}
