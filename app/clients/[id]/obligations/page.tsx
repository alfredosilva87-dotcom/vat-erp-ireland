"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClientObligation, RecurringObligation } from "@/lib/types";
import Link from "next/link";
import { useT } from "@/lib/i18n";

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: string): number | null => (v.trim() === "" ? null : Number(v.replace(",", ".")) || 0);

const emptyManual = { name: "", category: "", periodicity: "", due_date: "" };

/*
 * A sigla como se escreve, e não como está guardada.
 *
 * `PRELIMINARY_TAX` é o nome da coluna no banco, e ao lado de VAT3, CT1 e B1
 * lê-se como um erro. As outras três já são as siglas reais e ficam como estão.
 */
const SIGLA: Record<string, string> = { PRELIMINARY_TAX: "Prelim." };

const NOME_DA: Record<string, string> = {
  CT1: "imposto sobre o lucro",
  B1: "contas anuais no CRO",
  FORM11: "imposto do titular",
  PRELIMINARY_TAX: "pagamento por conta",
};

type Pagamento = {
  estado: "nao_se_aplica" | "sem_titulo" | "aberto" | "parcial" | "pago";
  ref: string | null; total: number | null; emAberto: number | null; pagoEm: string | null;
};

export default function Obligations({ params }: { params: { id: string } }) {
  const { t } = useT();
  const [obligations, setObligations] = useState<ClientObligation[]>([]);
  /*
   * ENTREGAR E PAGAR são dois factos.
   *
   * "Mark filed" responde a "entreguei a declaração?". Não responde a "paguei
   * o que ela apurou?" — e a Revenue cobra juros pelo atraso no pagamento
   * mesmo com a declaração entregue a horas. Ver
   * lib/fiscal/pagamentoDaObrigacao.ts.
   */
  const [pagamentos, setPagamentos] = useState<Record<string, Pagamento>>({});
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);

  const [manual, setManual] = useState<RecurringObligation[]>([]);
  const [manualForm, setManualForm] = useState({ ...emptyManual });
  const [showManualForm, setShowManualForm] = useState(false);

  const load = useCallback(async (refresh = false) => {
    const d = await (await fetch(
      `/api/clients/${params.id}/obligations?year=${year}${refresh ? "&refresh=1" : ""}`
    )).json();
    setObligations(d.obligations || []);
    setPagamentos(d.payments || {});
  }, [params.id, year]);

  const loadManual = useCallback(async () => {
    const d = await (await fetch(`/api/clients/${params.id}/recurring-obligations`)).json();
    setManual(d.obligations || []);
  }, [params.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadManual(); }, [loadManual]);

  async function addManual() {
    if (!manualForm.name.trim()) return;
    const res = await fetch(`/api/clients/${params.id}/recurring-obligations`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(manualForm),
    });
    if (res.ok) {
      setManualForm({ ...emptyManual });
      setShowManualForm(false);
      loadManual();
    }
  }

  async function patchManual(id: string, patch: Partial<RecurringObligation>) {
    setManual((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    await fetch(`/api/clients/${params.id}/recurring-obligations/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    loadManual();
  }

  async function removeManual(id: string) {
    await fetch(`/api/clients/${params.id}/recurring-obligations/${id}`, { method: "DELETE" });
    loadManual();
  }

  async function patchObl(id: string, patch: Partial<ClientObligation>) {
    setObligations((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    const d = await (await fetch(`/api/obligations/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    })).json();
    if (d.obligation) setObligations((prev) => prev.map((o) => (o.id === id ? d.obligation : o)));
  }

  async function refresh() {
    setBusy(true);
    await load(true);
    setBusy(false);
  }

  const yearOptions = Array.from(new Set([year + 1, year, year - 1, year - 2])).sort((a, b) => b - a);

  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 p-5">
          <div>
            <h2 className="font-display text-xl font-semibold">Tax obligations {year}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Bi-monthly VAT3 returns (due the 23rd of the following month) and the annual RTD.
              <strong className="text-ink"> T2</strong> (VAT on purchases) is auto-filled from this
              client&apos;s invoices; enter <strong className="text-ink">T1</strong> (VAT on sales)
              to get <strong className="text-ink">T3</strong>, the net position.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className="btn-ghost" onClick={refresh} disabled={busy}>
              {busy ? "Refreshing…" : "Refresh from invoices"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Return</th>
                <th className="px-3 py-3 font-medium">Period</th>
                <th className="px-3 py-3 font-medium">Due</th>
                <th className="px-3 py-3 font-medium text-right">T1 · VAT sales</th>
                <th className="px-3 py-3 font-medium text-right">T2 · VAT purchases</th>
                <th className="px-3 py-3 font-medium text-right">T3 · Net</th>
                <th className="px-3 py-3 font-medium text-center">{t("obl.colFiled")}</th>
                <th className="px-3 py-3 font-medium">{t("obl.colPaid")}</th>
              </tr>
            </thead>
            <tbody>
              {obligations.map((o) => {
                const net = (o.vat_on_sales || 0) - (o.vat_on_purchases || 0);
                const overdue = o.status === "open" && !!o.due_date
                  && o.due_date < new Date().toISOString().slice(0, 10);
                /*
                 * As colunas T1/T2/T3 são do IVA, e só do IVA.
                 *
                 * O CT1, a B1 e a Form 11 entraram nesta tabela porque partilham
                 * tudo o resto — período, prazo, entregue ou não. Mas não têm
                 * T1 nem T2: uma caixa de texto editável ali convidaria a
                 * escrever um número numa declaração que não o tem, e ele
                 * ficaria a parecer conferido.
                 */
                const deVat = o.kind === "VAT3" || o.kind === "RTD";
                return (
                  <tr key={o.id} className="border-b border-line/70 align-middle">
                    <td className="px-5 py-2 font-medium">
                      {SIGLA[o.kind] ?? o.kind}
                      {!deVat && <span className="ml-2 text-[11px] font-normal text-muted">{NOME_DA[o.kind] ?? ""}</span>}
                    </td>
                    <td className="px-3 py-2">{o.period_label}</td>
                    <td className="px-3 py-2 tnum">
                      {o.due_date ? (
                        <>
                          {o.due_date}
                          {overdue && <span className="ml-1 chip-danger">overdue</span>}
                        </>
                      ) : (
                        /*
                         * Sem prazo NÃO é um espaço em branco: é um cadastro por
                         * completar, e a linha diz qual campo falta. Uma data
                         * inventada ficaria verde e nunca mais seria olhada —
                         * ver lib/fiscal/calendario.ts.
                         */
                        <span className="chip-warn text-[11px]" title={o.notes ?? ""}>
                          sem prazo — falta no cadastro
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {deVat ? (
                        <input className="input h-9 w-24 text-right" defaultValue={o.vat_on_sales ?? ""}
                          disabled={o.status === "filed"}
                          onBlur={(e) => patchObl(o.id, { vat_on_sales: num(e.target.value) })} />
                      ) : <span className="block text-right text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {deVat ? (
                        <input className="input h-9 w-24 text-right" defaultValue={o.vat_on_purchases ?? ""}
                          disabled={o.status === "filed"}
                          onBlur={(e) => patchObl(o.id, { vat_on_purchases: num(e.target.value) })} />
                      ) : <span className="block text-right text-muted">—</span>}
                    </td>
                    <td className={`px-3 py-2 text-right tnum font-semibold ${deVat && net > 0 ? "text-danger" : deVat ? "text-success" : "text-muted"}`}>
                      {deVat ? money(net) : "—"}
                    </td>
                    {/*
                      * ENTREGUE — e desde quando.
                      *
                      * `filed_at` sempre foi gravado e nunca foi mostrado. Um
                      * visto sem data não responde à única pergunta que se faz
                      * a seguir: foi dentro do prazo? Com a data ao lado do
                      * vencimento, a resposta lê-se sem abrir nada.
                      */}
                    <td className="px-3 py-2 text-center">
                      {o.status === "filed" ? (
                        <button className="chip-ok" title={t("obl.undoFiled")}
                          onClick={() => patchObl(o.id, { status: "open" })}>
                          {t("obl.filed")}
                          {o.filed_at && <span className="ml-1 font-normal opacity-80">{o.filed_at.slice(0, 10)}</span>}
                        </button>
                      ) : (
                        <button className="btn-ghost h-8 px-3 text-xs" onClick={() => patchObl(o.id, { status: "filed" })}>
                          {t("obl.markFiled")}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Pago p={pagamentos[o.id]} clientId={params.id} t={t} />
                    </td>
                  </tr>
                );
              })}
              {!obligations.length && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">No obligations generated for {year} yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted">
        T3 &gt; 0 = payable to Revenue; T3 &lt; 0 = repayable. The RTD is informational (no payment).
      </p>

      {/*
        Segunda seção, deliberadamente separada da tabela VAT3/RTD acima: essas
        são entradas manuais de texto livre (CRO, CT1, P30...), não calculadas
        a partir de vendas/compras. Ver selfhost/schema/011_recurring_obligations.sql.
      */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <h2 className="font-display text-xl font-semibold">{t("obligations.manualTitle")}</h2>
          <button className="btn-ghost" onClick={() => setShowManualForm((v) => !v)}>
            {showManualForm ? t("common.close") : t("obligations.manualAdd")}
          </button>
        </div>

        {showManualForm && (
          <div className="grid gap-3 border-t border-line bg-surface-2/40 p-5 sm:grid-cols-2 lg:grid-cols-5">
            <input className="input" placeholder={t("obligations.manualName")}
              value={manualForm.name} onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })} />
            <input className="input" placeholder={t("obligations.manualCategory")}
              value={manualForm.category} onChange={(e) => setManualForm({ ...manualForm, category: e.target.value })} />
            <input className="input" placeholder={t("obligations.manualPeriodicity")}
              value={manualForm.periodicity} onChange={(e) => setManualForm({ ...manualForm, periodicity: e.target.value })} />
            <input className="input" type="date"
              value={manualForm.due_date} onChange={(e) => setManualForm({ ...manualForm, due_date: e.target.value })} />
            <button className="btn-primary" onClick={addManual}>{t("common.create")}</button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">{t("obligations.manualName")}</th>
                <th className="px-3 py-3 font-medium">{t("obligations.manualCategory")}</th>
                <th className="px-3 py-3 font-medium">{t("obligations.manualPeriodicity")}</th>
                <th className="px-3 py-3 font-medium">{t("obligations.manualDue")}</th>
                <th className="px-3 py-3 font-medium text-center">{t("obligations.manualStatus")}</th>
                <th className="px-3 py-3 font-medium text-center">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {manual.map((o) => (
                <tr key={o.id} className="border-b border-line/70 align-middle">
                  <td className="px-5 py-2 font-medium">{o.name}</td>
                  <td className="px-3 py-2">{o.category || "—"}</td>
                  <td className="px-3 py-2">{o.periodicity || "—"}</td>
                  <td className="px-3 py-2 tnum">{o.due_date || "—"}</td>
                  <td className="px-3 py-2 text-center">
                    {o.status === "done" ? (
                      <button className="chip-ok" onClick={() => patchManual(o.id, { status: "open" })}>{t("obligations.manualDone")}</button>
                    ) : (
                      <button className="btn-ghost h-8 px-3 text-xs" onClick={() => patchManual(o.id, { status: "done" })}>{t("obligations.manualMarkDone")}</button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button className="btn-ghost h-8 px-3 text-xs text-danger" onClick={() => removeManual(o.id)}>{t("common.delete")}</button>
                  </td>
                </tr>
              ))}
              {!manual.length && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">{t("obligations.manualEmpty")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/**
 * O ESTADO DE PAGAMENTO da obrigação, em duas palavras e um caminho.
 *
 * Não repete o valor da declaração — esse já está nas colunas T1/T2/T3. Diz o
 * que falta sair do banco, que é outra pergunta e a única que o dinheiro
 * responde. Quando há título, leva a ele: é lá que se dá a baixa.
 */
function Pago({ p, clientId, t }: {
  p?: { estado: string; ref: string | null; total: number | null; emAberto: number | null; pagoEm: string | null };
  clientId: string;
  t: (k: any, v?: Record<string, string | number>) => string;
}) {
  if (!p || p.estado === "nao_se_aplica") {
    // RTD, B1, Form 11: não é que estejam por pagar — é que o pagamento delas
    // não passa por aqui. Um "em aberto" nessas linhas seria falso.
    return <span className="text-muted">—</span>;
  }

  const verLista = (
    <Link className="underline" href={`/clients/${clientId}/payable?status=todos&q=${encodeURIComponent(p.ref ?? "")}`}>
      {t("obl.seeTitle")}
    </Link>
  );

  if (p.estado === "sem_titulo") {
    /* Sem título ainda: o caminho é a aba do imposto, onde o apurado vira
       título a pagar. Ver components/fiscal/TaxPanel.tsx. */
    return (
      <Link className="chip text-[11px] hover:underline" href={`/clients/${clientId}/accounting`}>
        {t("obl.noTitle")}
      </Link>
    );
  }
  if (p.estado === "pago") {
    return (
      <span className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <span className="chip-ok text-[11px]">{t("obl.paid")}</span>
        {p.pagoEm && <span className="text-muted">{p.pagoEm}</span>}
        {verLista}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[12px]">
      <span className={`text-[11px] ${p.estado === "parcial" ? "chip-warn" : "chip-danger"}`}>
        {t(p.estado === "parcial" ? "obl.partial" : "obl.unpaid")}
      </span>
      <span className="font-mono tabular-nums">
        €{(p.emAberto ?? 0).toLocaleString("en-IE", { minimumFractionDigits: 2 })}
      </span>
      {verLista}
    </span>
  );
}
