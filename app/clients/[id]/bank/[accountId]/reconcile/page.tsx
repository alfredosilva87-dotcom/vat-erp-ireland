"use client";

/**
 * Conciliação (camada A2).
 *
 * Três blocos, e a ordem é a do trabalho: o que falta conciliar, o que já foi,
 * e o que foi lançado aqui mas o extrato ainda não mostrou. O último é o que
 * explica a diferença entre os dois saldos no fim do mês — sem ele, o contador
 * vê um número que não fecha e não tem onde procurar.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ReconcileRow, { type PendingLine } from "@/components/ReconcileRow";
import type { MatchCandidate } from "@/lib/bankMatch";
import type { BankAccount, BankAccountBalance, StoredStatementLine } from "@/lib/types";

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface OutstandingTxn {
  id: string;
  txn_date: string;
  description: string | null;
  contact_name: string | null;
  amount: number;
  reason: string | null;
}

export default function Reconcile({ params }: { params: { id: string; accountId: string } }) {
  const [account, setAccount] = useState<BankAccount | null>(null);
  const [balance, setBalance] = useState<BankAccountBalance | null>(null);
  const [pending, setPending] = useState<PendingLine[]>([]);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [outstanding, setOutstanding] = useState<OutstandingTxn[]>([]);
  const [accounts, setAccounts] = useState<{ code: string; description: string }[]>([]);
  const [done, setDone] = useState<StoredStatementLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const base = `/api/clients/${params.id}/bank-accounts/${params.accountId}`;

  const load = useCallback(async () => {
    // no-store porque o navegador também guarda GET: depois de conciliar, a
    // tela tem que mostrar o que o banco de dados diz, não o que ela mostrava.
    const [r1, r2, r3] = await Promise.all([
      fetch(`${base}/reconcile`, { cache: "no-store" }),
      fetch(`${base}?status=reconciled&limit=100`, { cache: "no-store" }),
      fetch(`/api/clients/${params.id}/accounts`, { cache: "no-store" }),
    ]);
    if (r3.ok) {
      const d = await r3.json();
      setAccounts((d.accounts || []).map((a: any) => ({ code: a.code, description: a.description })));
    }
    if (r1.ok) {
      const d = await r1.json();
      setAccount(d.account); setBalance(d.balance);
      setPending(d.lines || []); setCandidates(d.candidates || []);
      setOutstanding(d.outstanding || []);
    }
    if (r2.ok) setDone((await r2.json()).lines || []);
    setLoading(false);
  }, [base]);
  useEffect(() => { load(); }, [load]);

  async function confirm(lineId: string, choice: any) {
    setBusy(true);
    try {
      const res = await fetch(`${base}/lines/${lineId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(choice),
      });
      const d = await res.json();
      setMsg(res.ok ? { text: "Conciliada." } : { text: d.error || "Não foi possível conciliar.", error: true });
      await load();
    } finally { setBusy(false); }
  }

  async function revert(lineId: string, mode: "unlink" | "undo") {
    setBusy(true);
    try {
      const res = await fetch(`${base}/lines/${lineId}?mode=${mode}`, { method: "DELETE" });
      const d = await res.json();
      setMsg(res.ok
        ? {
            text: mode === "unlink"
              ? `Desconciliada. O pagamento continua lançado (${d.affected} movimento(s)).`
              : `Refeita. ${d.affected} movimento(s) apagado(s) — o documento volta a dever.`,
          }
        : { text: d.error || "Não foi possível.", error: true });
      await load();
    } finally { setBusy(false); }
  }

  if (loading) return <p className="card p-6 text-muted">Carregando…</p>;
  if (!account) return <p className="card p-6 text-muted">Conta não encontrada.</p>;

  const gap = balance ? Number((balance.statement_balance - balance.system_balance).toFixed(2)) : 0;

  /*
   * A DIFERENÇA decomposta — e o que ela NÃO consegue detectar.
   *
   * Antes o topo mostrava só "Diferença € -3.533,74" a vermelho. Está certa, e
   * não diz nada: com linhas por conciliar e pagamentos em aberto, uma
   * diferença é o estado NORMAL — existe porque há trabalho por fazer. Marcar
   * isso a vermelho todos os dias ensina a ignorar o número.
   *
   * ATENÇÃO ao que isto é e ao que não é. O saldo do extrato aqui NÃO vem do
   * banco: é calculado a partir das linhas que foram importadas. Logo
   *
   *   saldo extrato − saldo sistema  ≡  (por conciliar) − (lançados sem linha)
   *
   * é uma identidade, não uma verificação — bate sempre, por construção. Uma
   * linha que nunca foi importada muda os dois lados na mesma medida e não
   * aparece aqui.
   *
   * Quem apanha isso é o FECHAMENTO, onde se digita o saldo que está no
   * extrato de papel e se compara com o calculado. É a única vez que entra no
   * sistema um número que não saiu dele próprio.
   */
  const r2 = (n: number) => Number(n.toFixed(2));
  const totalPorConciliar = r2(pending.reduce((s, p) => s + Number(p.line.amount || 0), 0));
  const totalEmAberto = r2(outstanding.reduce((s, t) => s + Number(t.amount || 0), 0));

  return (
    <div className="space-y-6">
      <div className="rise">
        <Link href={`/clients/${params.id}/bank/${params.accountId}`} className="text-xs font-medium text-brand-700">
          ← {account.name}
        </Link>
        <h1 className="mt-0.5 font-display text-xl font-semibold tracking-tight">Conciliar</h1>
        <p className="mt-1 text-muted">
          À esquerda, o que o banco informou. À direita, o que vai ser lançado. Nada é gravado sem
          você confirmar.
        </p>
      </div>

      <div className="card grid gap-px overflow-hidden bg-line sm:grid-cols-4">
        <Stat label="Saldo do extrato" value={`€ ${money(balance?.statement_balance)}`} />
        <Stat label="Saldo no sistema" value={`€ ${money(balance?.system_balance)}`} accent />
        <Stat label="Diferença" value={`€ ${money(gap)}`} />
        <Stat label="Por conciliar" value={String(pending.length)} />
      </div>

      {/* De onde vem a diferença — ver o comentário no cálculo acima. */}
      {gap !== 0 && (
        <div className="card border-l-4 border-l-brand p-4">
          <p className="text-sm">
            A diferença é o <strong>trabalho que falta</strong>, e não um erro: são as linhas por
            conciliar menos os pagamentos já lançados que o extrato ainda não mostrou.
          </p>
          <div className="mt-2 flex flex-wrap gap-5 font-mono text-sm tabular-nums">
            <span className="text-muted">
              Por conciliar ({pending.length}) <b className="text-ink">€ {money(totalPorConciliar)}</b>
            </span>
            <span className="text-muted">
              Lançados sem extrato ({outstanding.length}) <b className="text-ink">€ {money(totalEmAberto)}</b>
            </span>
            <span className="text-muted">
              Diferença <b className="text-ink">€ {money(gap)}</b>
            </span>
          </div>
          <p className="mt-2 text-xs text-muted">
            Esta conta fecha sempre, porque o saldo do extrato aqui é calculado a partir das linhas
            importadas — não vem do banco. Para saber se falta alguma linha, use o{" "}
            <Link className="underline" href={`/clients/${params.id}/bank/${params.accountId}/closing`}>
              fechamento
            </Link>
            : é lá que se digita o saldo do extrato de papel e se compara com o calculado.
          </p>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Por conciliar</h2>
        {!pending.length ? (
          <p className="card p-6 text-muted">
            Nada por conciliar nesta conta. {gap !== 0 && "A diferença que resta vem dos pagamentos em aberto abaixo."}
          </p>
        ) : (
          pending.map((item) => (
            <ReconcileRow key={item.line.id} item={item} candidates={candidates} accounts={accounts}
              busy={busy} onConfirm={confirm} />
          ))
        )}
      </section>

      {!!done.length && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Conciliadas</h2>
          <p className="-mt-2 text-sm text-muted">
            <strong>Desconciliar</strong> tira só o vínculo — o pagamento continua lançado no
            documento. <strong>Refazer</strong> apaga o movimento e o documento volta a dever.
          </p>
          <div className="card overflow-hidden">
            <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Data</th>
                  <th className="px-4 py-2 font-medium">Descrição</th>
                  <th className="px-4 py-2 font-medium text-right">Valor €</th>
                  <th className="px-4 py-2 font-medium text-center">—</th>
                </tr>
              </thead>
              <tbody>
                {done.map((l) => (
                  <tr key={l.id} className="border-b border-line/70">
                    <td className="px-4 py-2 tnum">{l.line_date}</td>
                    <td className="px-4 py-2">{l.description || "—"}</td>
                    <td className={`px-4 py-2 text-right tnum ${Number(l.amount) < 0 ? "text-danger" : "text-brand-700"}`}>
                      {money(l.amount)}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <button className="btn-ghost h-8 px-3 text-xs" disabled={busy}
                        onClick={() => revert(l.id, "unlink")}>Desconciliar</button>
                      <button className="btn-ghost h-8 px-3 text-xs text-danger" disabled={busy}
                        onClick={() => revert(l.id, "undo")}>Refazer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </section>
      )}

      {!!outstanding.length && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Pagamentos em aberto</h2>
          <p className="-mt-2 text-sm text-muted">
            Lançados aqui, mas nenhuma linha do extrato os explica ainda. É daqui que sai parte da
            diferença entre os dois saldos.
          </p>
          <div className="card overflow-hidden">
            <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Data</th>
                  <th className="px-4 py-2 font-medium">Descrição</th>
                  <th className="px-4 py-2 font-medium">Motivo</th>
                  <th className="px-4 py-2 font-medium text-right">Valor €</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((t) => (
                  <tr key={t.id} className="border-b border-line/70">
                    <td className="px-4 py-2 tnum">{t.txn_date}</td>
                    <td className="px-4 py-2">{t.description || t.contact_name || "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted">{t.reason || "—"}</td>
                    <td className={`px-4 py-2 text-right tnum ${Number(t.amount) < 0 ? "text-danger" : "text-brand-700"}`}>
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
