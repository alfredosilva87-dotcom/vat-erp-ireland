"use client";

import { useCallback, useEffect, useState } from "react";
import { useT, type TKey } from "@/lib/i18n";
import { currentIsoWeek } from "@/lib/hr/payroll";

/**
 * A SUBMISSÃO À REVENUE (PSR).
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA TELA É, E O QUE ELA NÃO É
 *
 * Não envia nada. O envio faz-se pelo ROS, com o certificado digital do
 * escritório — e isso é uma credencial, que não entra num sistema sem que quem
 * manda nela decida como.
 *
 * O que falta a quem já submete à mão não é um canal: é saber, ANTES de
 * carregar em enviar, que a submissão está completa — e ficar com registo do
 * que comunicou. É isso que está aqui.
 *
 * ---------------------------------------------------------------------------
 * O QUE BLOQUEIA VEM PRIMEIRO, E EM VERMELHO
 *
 * Uma submissão rejeitada descobre-se e corrige-se. Uma submissão ACEITE com um
 * PPS errado não dá sinal nenhum — o imposto de quem trabalhou aqui foi
 * creditado a outra pessoa, e isso aparece meses depois.
 */

type Reparo = { codigo: string; params?: Record<string, string | number>; bloqueia: boolean };
type Linha = {
  employeeId: string; nome: string; pps: string | null; employmentId: string | null;
  brutoCents: number; payeCents: number; uscCents: number;
  prsiEmpregadoCents: number; prsiEmpregadorCents: number;
  classePRSI: string | null; semanasSeguraveis: number; reparos: Reparo[];
};
type Submissao = {
  year: number; periodNo: number; freqType: string; payDate: string;
  employerNumber: string | null;
  linhas: Linha[];
  totais: {
    pessoas: number; bruto: number; paye: number; usc: number;
    prsiEe: number; prsiEr: number; semanas: number; aPagar: number;
  };
  atrasoDias: number; bloqueios: number;
  registada: { id: string; status: string; rosReference: string | null; submittedAt: string | null } | null;
  lacunas: string[];
};

const eur = (c: number) =>
  (c / 100).toLocaleString("en-IE", { style: "currency", currency: "EUR" });

export default function RevenueSubmission({
  clientId, year, freqType,
}: {
  clientId: string; year: number; freqType: "weekly" | "fortnightly" | "monthly";
}) {
  const { t } = useT();
  const maxPeriodo = freqType === "weekly" ? 53 : freqType === "fortnightly" ? 27 : 12;
  const [periodo, setPeriodo] = useState(() => {
    const semana = currentIsoWeek();
    if (freqType === "weekly") return Math.min(semana, maxPeriodo);
    if (freqType === "fortnightly") return Math.min(Math.ceil(semana / 2), maxPeriodo);
    return new Date().getMonth() + 1;
  });
  const [d, setD] = useState<Submissao | null>(null);
  const [referencia, setReferencia] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null); setRecado(null);
    const r = await fetch(
      `/api/hr/companies/${clientId}/psr?year=${year}&period=${periodo}&freq=${freqType}`,
      { cache: "no-store" }
    );
    const j = await r.json();
    if (!r.ok) { setErro(j.error || "Falhou."); setD(null); return; }
    setD(j); setReferencia(j.registada?.rosReference ?? "");
  }, [clientId, year, periodo, freqType]);

  useEffect(() => { carregar(); }, [carregar]);

  async function registar() {
    setOcupado(true); setErro(null); setRecado(null);
    try {
      const r = await fetch(`/api/hr/companies/${clientId}/psr`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, period: periodo, freq: freqType, rosReference: referencia }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falhou."); return; }
      setRecado(t("psr.recorded", { n: j.linhas }));
      await carregar();
    } finally { setOcupado(false); }
  }

  /*
   * O ficheiro sai do NAVEGADOR, e não de uma rota.
   *
   * É a mesma tabela que já está no ecrã, e quem a leva é quem a está a ver.
   * Uma rota nova só para isto seria mais um sítio por onde dados de PPS
   * saem do sistema.
   */
  function baixarCsv() {
    if (!d) return;
    const cab = ["Name", "PPS", "EmploymentID", "PayDate", "Gross", "PAYE", "USC",
      "PRSI_EE", "PRSI_ER", "PRSIClass", "InsurableWeeks"];
    const linhas = d.linhas.map((l) => [
      l.nome, l.pps ?? "", l.employmentId ?? "", d.payDate,
      (l.brutoCents / 100).toFixed(2), (l.payeCents / 100).toFixed(2),
      (l.uscCents / 100).toFixed(2), (l.prsiEmpregadoCents / 100).toFixed(2),
      (l.prsiEmpregadorCents / 100).toFixed(2), l.classePRSI ?? "", String(l.semanasSeguraveis),
    ]);
    const csv = [cab, ...linhas]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `psr-${d.year}-${String(d.periodNo).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const comunicada = d?.registada?.status === "sent";

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("run.period")}</span>
          <select className="input mt-1 h-9 w-auto cursor-pointer py-0 text-[13px] font-semibold"
            value={periodo} onChange={(e) => setPeriodo(Number(e.target.value))}>
            {Array.from({ length: maxPeriodo }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        {d && (
          <p className="pb-2 text-[12.5px] text-muted">
            {t("run.payDate")}: <span className="font-mono">{d.payDate}</span>
            {d.employerNumber && <> · {t("payslip.employerNo")} <span className="font-mono">{d.employerNumber}</span></>}
          </p>
        )}
      </div>

      <p className="mt-3 max-w-3xl text-[12.5px] text-muted">{t("psr.help")}</p>

      {/*
        O ATRASO é o aviso mais importante desta tela.

        Desde 2019 comunica-se NO DIA do pagamento ou antes — não há prazo no mês
        seguinte. Quem vem de um sistema antigo traz o hábito de fechar no fim
        do mês, e esse hábito é uma infracção por semana.
      */}
      {!!d?.atrasoDias && !comunicada && (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px]">
          {t("psr.late", { n: d.atrasoDias })}
        </p>
      )}

      {erro && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>}
      {recado && <p className="mt-3 rounded-lg border border-ok/40 bg-success-50 px-3 py-2 text-sm">{recado}</p>}

      {d && !d.linhas.length && (
        <p className="mt-4 rounded-lg border border-line bg-surface-2/60 px-3 py-6 text-center text-[13px] text-muted">
          {t("psr.nothingClosed")}
        </p>
      )}

      {!!d?.linhas.length && (
        <>
          <div className="-mx-1 mt-4 overflow-x-auto px-1">
            <table className="row-hover w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-medium">{t("run.colEmployee")}</th>
                  <th className="px-3 py-2 font-medium">{t("payslip.pps")}</th>
                  <th className="px-3 py-2 font-medium">{t("emp.employmentId")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("run.colGross")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("run.colPaye")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("run.colUsc")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("run.colPrsiEe")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("run.colPrsiEr")}</th>
                  <th className="px-3 py-2 font-medium">{t("payslip.prsiClass")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("psr.colWeeks")}</th>
                </tr>
              </thead>
              <tbody>
                {d.linhas.map((l) => (
                  <tr key={l.employeeId} className="border-b border-line/60 align-top">
                    <td className="px-3 py-2">
                      <span className="font-medium">{l.nome}</span>
                      {/* O reparo vive ao pé de quem ele é — um resumo no topo
                          obriga a descobrir de quem se trata. */}
                      {l.reparos.map((r, i) => (
                        <p key={i} className={`text-[11px] ${r.bloqueia ? "text-danger" : "text-warning"}`}>
                          · {t(r.codigo as TKey, r.params)}
                        </p>
                      ))}
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px]">
                      {l.pps || <span className="text-danger">—</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px]">
                      {l.employmentId || <span className="text-danger">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.brutoCents)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.payeCents)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.uscCents)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.prsiEmpregadoCents)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">{eur(l.prsiEmpregadorCents)}</td>
                    <td className="px-3 py-2">{l.classePRSI || "—"}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{l.semanasSeguraveis}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-semibold">
                  <td className="px-3 py-2" colSpan={3}>{t("run.totals")}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d.totais.bruto)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d.totais.paye)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d.totais.usc)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d.totais.prsiEe)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d.totais.prsiEr)}</td>
                  <td />
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{d.totais.semanas}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/*
            O QUE SE PAGA À REVENUE inclui as DUAS partes do PRSI.
            Esquecer a do empregador é o erro clássico: a conta do mês vem maior
            do que o escritório provisionou e ninguém percebe de onde saiu.
          */}
          <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface-2/60 px-4 py-3">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
              {t("psr.toPay")}
            </span>
            <span className="font-mono text-lg font-semibold tabular-nums">{eur(d.totais.aPagar)}</span>
            <span className="text-[12px] text-muted">{t("psr.toPayHelp")}</span>
          </div>

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t("psr.gaps")}
          </p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-muted">
            {d.lacunas.map((k) => <li key={k}>· {t(k as TKey)}</li>)}
          </ul>

          {comunicada ? (
            <div className="mt-4 rounded-lg border border-ok/40 bg-success-50 px-3 py-3 text-[13px]">
              <p className="font-medium">{t("psr.alreadySent")}</p>
              <p className="mt-1 font-mono text-[12px]">{d.registada?.rosReference}</p>
              <p className="mt-1 text-[12px] text-muted">
                {String(d.registada?.submittedAt ?? "").slice(0, 16).replace("T", " ")}
              </p>
              <p className="mt-2 text-[12px] text-muted">{t("psr.correctionHelp")}</p>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {!!d.bloqueios && (
                <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
                  {t("psr.blocked", { n: d.bloqueios })}
                </p>
              )}
              <label className="block max-w-xl">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                  {t("psr.reference")}
                </span>
                <input className="input mt-1 w-full text-sm" value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  placeholder={t("psr.referencePlaceholder")} />
              </label>
              <p className="max-w-xl text-[12px] text-muted">{t("psr.referenceHelp")}</p>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-ghost h-9 px-4 text-sm" onClick={baixarCsv}>{t("psr.csv")}</button>
            {!comunicada && (
              <button className="btn-primary h-9 px-4 text-sm"
                disabled={ocupado || !!d.bloqueios || referencia.trim().length < 3}
                onClick={registar}>
                {ocupado ? "…" : t("psr.record")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
