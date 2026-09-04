"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useT, type TKey } from "@/lib/i18n";

/**
 * O QUE JÁ SE PAGOU — o histórico que não tinha ecrã.
 *
 * ---------------------------------------------------------------------------
 * A PERGUNTA A QUE ISTO RESPONDE
 *
 * "Porque é que esta semana reteve tanto?" — feita em Novembro sobre um recibo
 * de Julho. Um total sozinho não a responde; o cut-off, os créditos e a base
 * usados naquele dia respondem.
 *
 * Por isso a linha traz esses três ao lado do número, e não escondidos. Eles já
 * eram gravados em `hr_payslip` desde sempre; o que faltava era mostrá-los.
 *
 * ---------------------------------------------------------------------------
 * RASCUNHO E FECHADO NÃO SE MISTURAM
 *
 * Um período por fechar tem números que ainda vão mudar. Aparecem à mesma — não
 * os mostrar dava a ideia de que a folha não tinha corrido — mas marcados, e a
 * soma do ano conta só o que está fechado.
 */

type Recibo = {
  id: string; employee_id: string; nome: string;
  period_no: number; freq_type: string; pay_date: string;
  gross_cents: number; paye_cents: number; usc_cents: number;
  prsi_ee_cents: number; prsi_er_cents: number; net_cents: number;
  cum_gross_cents: number; cum_paye_cents: number;
  cutoff_used_cents: number; credits_used_cents: number;
  basis: string; tax_year_used: number | null; table_confirmed: boolean;
  warnings: any[]; status: "draft" | "final"; finalised_at: string | null;
};

const eur = (c: number) =>
  (c / 100).toLocaleString("en-IE", { style: "currency", currency: "EUR" });

/**
 * A base guardada e a chave de tradução não têm o mesmo nome.
 *
 * `hr_payslip.basis` grava `cumulativa` / `emergencia` (o vocabulário do
 * cálculo); as traduções são `basis.cumulative` / `basis.emergency`. Sem esta
 * ponte a coluna saía com a chave crua à vista, que é o género de detalhe que
 * faz um ecrã parecer inacabado.
 */
const CHAVE_DA_BASE: Record<string, string> = {
  cumulativa: "basis.cumulative",
  cumulative: "basis.cumulative",
  week1: "basis.week1",
  emergencia: "basis.emergency",
  emergency: "basis.emergency",
};

export default function HistoricoDeRecibos({
  clientId, year, funcionarios,
}: {
  clientId: string; year: number;
  funcionarios: { id: string; nome: string }[];
}) {
  const { t } = useT();
  const [quem, setQuem] = useState("");
  const [d, setD] = useState<{ linhas: Recibo[]; truncado: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const r = await fetch(
        `/api/hr/companies/${clientId}/payslips/history?year=${year}`
        + (quem ? `&employee=${quem}` : ""),
        { cache: "no-store" }
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error || t("hist.falhou")); setD(null); return; }
      setD(j);
    } catch {
      setErro(t("hist.falhou"));
    } finally { setCarregando(false); }
  }, [clientId, year, quem, t]);

  useEffect(() => { carregar(); }, [carregar]);

  const linhas = d?.linhas ?? [];

  /*
   * O TOTAL DO ANO conta só o que está FECHADO.
   *
   * Somar rascunhos daria um número que muda sozinho entre duas visitas ao
   * ecrã — e ninguém confia num total que se mexe.
   */
  const total = useMemo(() => {
    const f = linhas.filter((l) => l.status === "final");
    return {
      n: f.length,
      bruto: f.reduce((s, l) => s + l.gross_cents, 0),
      paye: f.reduce((s, l) => s + l.paye_cents, 0),
      usc: f.reduce((s, l) => s + l.usc_cents, 0),
      prsiEe: f.reduce((s, l) => s + l.prsi_ee_cents, 0),
      prsiEr: f.reduce((s, l) => s + l.prsi_er_cents, 0),
      liquido: f.reduce((s, l) => s + l.net_cents, 0),
    };
  }, [linhas]);

  const recibo = (l: Recibo) =>
    `/api/hr/companies/${clientId}/payslips?year=${year}&period=${l.period_no}`
    + `&freq=${l.freq_type}&employee=${l.employee_id}`;

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
            {t("hist.pessoa")}
          </span>
          <select className="input mt-1 h-9 w-auto cursor-pointer py-0 text-[13px]"
            value={quem} onChange={(e) => setQuem(e.target.value)}>
            <option value="">{t("hist.todas")}</option>
            {funcionarios.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
        <p className="pb-2 text-[12.5px] text-muted">
          {t("hist.resumo", { n: String(total.n), bruto: eur(total.bruto), liquido: eur(total.liquido) })}
        </p>
      </div>

      {erro && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>}
      {d?.truncado && (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px]">
          {t("hist.truncado")}
        </p>
      )}

      <div className="-mx-1 mt-3 overflow-x-auto px-1">
        <table className="row-hover w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2 font-medium">{t("hist.colPeriodo")}</th>
              <th className="px-3 py-2 font-medium">{t("run.colEmployee")}</th>
              <th className="px-3 py-2 font-medium">{t("hist.colPagoEm")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colGross")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colPaye")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colUsc")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colPrsiEe")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colNet")}</th>
              <th className="px-3 py-2 font-medium">{t("run.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <Fragment key={l.id}>
                <tr className="cursor-pointer border-b border-line/60"
                  onClick={() => setAberto(aberto === l.id ? null : l.id)}>
                  <td className="px-3 py-2 font-mono">
                    {t("hr.weekShort")}{l.period_no}
                    <span className="ml-1 text-[10.5px] text-muted">{l.freq_type}</span>
                  </td>
                  <td className="px-3 py-2 font-medium">{l.nome}</td>
                  <td className="px-3 py-2 font-mono text-[11.5px] text-muted">{l.pay_date}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.gross_cents)}</td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${l.paye_cents < 0 ? "text-ok" : ""}`}>
                    {eur(l.paye_cents)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.usc_cents)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.prsi_ee_cents)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{eur(l.net_cents)}</td>
                  <td className="px-3 py-2">
                    {l.status === "final"
                      ? <span className="chip-ok">{t("run.final")}</span>
                      : <span className="chip">{t("run.draft")}</span>}
                  </td>
                </tr>

                {/* A LINHA ABERTA: o que foi usado para chegar àquele número. */}
                {aberto === l.id && (
                  <tr className="border-b border-line/60 bg-surface-2/40">
                    <td colSpan={9} className="px-3 py-3">
                      <dl className="flex flex-wrap gap-x-8 gap-y-1.5 text-[12.5px]">
                        <Par rotulo={t("hist.base")} valor={t((CHAVE_DA_BASE[l.basis] ?? "basis.cumulative") as TKey)} />
                        <Par rotulo={t("hist.cutOff")} valor={eur(l.cutoff_used_cents)} />
                        <Par rotulo={t("hist.creditos")} valor={eur(l.credits_used_cents)} />
                        <Par rotulo={t("hist.tabela")}
                          valor={`${l.tax_year_used ?? "—"}${l.table_confirmed ? "" : " · " + t("hist.tabelaPorConfirmar")}`} />
                        <Par rotulo={t("hist.acumBruto")} valor={eur(l.cum_gross_cents)} />
                        <Par rotulo={t("hist.acumPaye")} valor={eur(l.cum_paye_cents)} />
                        <Par rotulo={t("run.colPrsiEr")} valor={eur(l.prsi_er_cents)} />
                      </dl>
                      {!!(l.warnings ?? []).length && (
                        <ul className="mt-2 space-y-0.5 text-[12px] text-warning">
                          {(l.warnings ?? []).map((w: any, i: number) => (
                            <li key={i}>· {t((w?.codigo ?? w) as TKey, w?.params)}</li>
                          ))}
                        </ul>
                      )}
                      <a className="mt-2 inline-block text-[12px] underline" href={recibo(l)}
                        target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}>
                        {t("run.payslip")}
                      </a>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!linhas.length && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-muted">
                  {carregando ? "…" : t("hist.vazio")}
                </td>
              </tr>
            )}
          </tbody>
          {!!linhas.length && (
            <tfoot>
              <tr className="border-t-2 border-line font-semibold">
                <td className="px-3 py-2" colSpan={3}>{t("hist.totalFechado")}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(total.bruto)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(total.paye)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(total.usc)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(total.prsiEe)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(total.liquido)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Par({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">{rotulo}</dt>
      <dd className="font-mono tabular-nums">{valor}</dd>
    </div>
  );
}
