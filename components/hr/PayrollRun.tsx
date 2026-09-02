"use client";

import { useCallback, useEffect, useState } from "react";
import { useT, type TKey } from "@/lib/i18n";

/** O servidor manda chave + parametros; a traducao acontece aqui. */
type Aviso = { codigo: string; params?: Record<string, string | number> };

/**
 * CORRER A FOLHA — bruto, imposto, líquido, e o que a pessoa custa.
 *
 * ---------------------------------------------------------------------------
 * PRÉ-VISUALIZAR E FECHAR SÃO COISAS DIFERENTES
 *
 * A pré-visualização calcula e não grava: pode correr as vezes que forem
 * precisas, e é o que se olha para conferir. Fechar é o acto que faz aqueles
 * números virarem o acumulado de que o período seguinte parte — e a partir daí
 * não se alteram, só se reabrem.
 *
 * Se abrir a tela contasse para o acumulado, abrir duas vezes somava duas
 * vezes, e a folha seguinte vinha errada sem nada a apontar a causa.
 *
 * ---------------------------------------------------------------------------
 * OS AVISOS FICAM AO LADO DA LINHA, E NÃO NUM RESUMO
 *
 * "3 avisos" no topo obriga a descobrir de quem são. Ao lado do nome, quem
 * confere vê logo que é o João que está sem PPS e a Maria em base de
 * emergência — que são coisas para tratar antes de fechar, não depois.
 */

type Linha = {
  employeeId: string; nome: string; jobTitle: string | null;
  brutoCents: number; payeCents: number; uscCents: number;
  prsiEeCents: number; prsiErCents: number; liquidoCents: number;
  custoEmpregadorCents: number; aeEeCents: number; aeErCents: number;
  acumulado: { bruto: number; paye: number; usc: number; prsi: number };
  aplicado: { cutOff: number; creditos: number; base: string };
  avisos: Aviso[]; devolucaoSeguraCents: number; status: "draft" | "final" | null;
};
type Folha = {
  year: number; periodNo: number; freqType: string; payDate: string;
  linhas: Linha[];
  totais: { bruto: number; paye: number; usc: number; prsiEe: number; prsiEr: number; aeEe: number; aeEr: number; liquido: number; custoEmpregador: number };
  avisos: Aviso[];
};

const eur = (c: number) =>
  (c / 100).toLocaleString("en-IE", { style: "currency", currency: "EUR" });

export default function PayrollRun({
  clientId, year, freqType,
}: {
  clientId: string; year: number; freqType: "weekly" | "fortnightly" | "monthly";
}) {
  const { t } = useT();
  const maxPeriodo = freqType === "weekly" ? 53 : freqType === "fortnightly" ? 27 : 12;
  const [periodo, setPeriodo] = useState(1);
  const [d, setD] = useState<Folha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    const r = await fetch(
      `/api/hr/companies/${clientId}/payroll?year=${year}&period=${periodo}&freq=${freqType}`,
      { cache: "no-store" }
    );
    const j = await r.json();
    if (!r.ok) { setErro(j.error || "Falhou."); setD(null); return; }
    setD(j);
  }, [clientId, year, periodo, freqType]);

  useEffect(() => { carregar(); }, [carregar]);

  /*
   * SEGURAR uma devolucao.
   *
   * Quem sai da base de emergencia recebe de volta centenas de euros numa
   * semana, e esse dinheiro sai do bolso do empregador na hora. A decisao de
   * adiar e de quem paga; aqui so se respeita e se grava — com o motivo, que e
   * o que torna a decisao defensavel tres meses depois.
   */
  async function segurar(l: Linha, segurar: boolean) {
    let reason = "";
    if (segurar) {
      reason = window.prompt(t("run.holdWhy")) ?? "";
      if (!reason.trim()) return;
    }
    setOcupado(true); setErro(null);
    try {
      const r = await fetch(`/api/hr/companies/${clientId}/payroll`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year, period: periodo, freq: freqType,
          acao: segurar ? "segurar" : "soltar", employeeId: l.employeeId, reason,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falhou."); return; }
      await carregar();
    } finally { setOcupado(false); }
  }

  async function acao(acao: "fechar" | "reabrir") {
    setOcupado(true); setErro(null); setRecado(null);
    try {
      const r = await fetch(`/api/hr/companies/${clientId}/payroll`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, period: periodo, freq: freqType, acao }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falhou."); return; }
      setRecado(acao === "fechar"
        ? t("run.finalised", { n: j.gravados })
        : t("run.reopened", { n: j.reabertos }));
      await carregar();
    } finally { setOcupado(false); }
  }

  const fechado = (d?.linhas ?? []).some((l) => l.status === "final");
  const avisos = [...(d?.avisos ?? [])];

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
          </p>
        )}
      </div>

      {!!avisos.length && (
        <ul className="mt-3 space-y-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px]">
          {avisos.map((a, i) => <li key={i}>{t(a.codigo as TKey, a.params)}</li>)}
        </ul>
      )}
      {erro && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>}
      {recado && <p className="mt-3 rounded-lg border border-ok/40 bg-success-50 px-3 py-2 text-sm">{recado}</p>}

      <div className="-mx-1 mt-3 overflow-x-auto px-1">
        <table className="row-hover w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2 font-medium">{t("run.colEmployee")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colGross")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colPaye")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colUsc")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colPrsiEe")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colAe")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colNet")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colPrsiEr")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colCost")}</th>
              <th className="px-3 py-2 font-medium">{t("run.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {(d?.linhas ?? []).map((l) => (
              <tr key={l.employeeId} className="border-b border-line/60 align-top">
                <td className="px-3 py-2">
                  <span className="font-medium">{l.nome}</span>
                  {l.jobTitle && <span className="ml-2 text-[11.5px] text-muted">{l.jobTitle}</span>}
                  {/* O aviso vive ao pé do nome de quem ele é. */}
                  {!!l.avisos.length && (
                    <ul className="mt-0.5 space-y-0.5 text-[11px] text-warning">
                      {l.avisos.map((a, i) => <li key={i}>· {t(a.codigo as TKey, a.params)}</li>)}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.brutoCents)}</td>
                {/* PAYE negativo é DEVOLUÇÃO, e o cumulativo fá-la sozinho. */}
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${l.payeCents < 0 ? "text-ok" : ""}`}>
                  {eur(l.payeCents)}
                  {/*
                    O botao so aparece quando ha decisao a tomar: com devolucao
                    por pagar, ou com uma ja segura para soltar. Um botao sempre
                    visivel que na maior parte das vezes nao faz nada ensina a
                    ignora-lo.
                  */}
                  {l.status !== "final" && l.payeCents < 0 && (
                    <button className="mt-0.5 block w-full text-right text-[11px] underline"
                      disabled={ocupado} onClick={() => segurar(l, true)}>
                      {t("run.hold")}
                    </button>
                  )}
                  {l.status !== "final" && l.devolucaoSeguraCents > 0 && (
                    <button className="mt-0.5 block w-full text-right text-[11px] text-warning underline"
                      disabled={ocupado} onClick={() => segurar(l, false)}>
                      {t("run.release", { v: eur(l.devolucaoSeguraCents) })}
                    </button>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.uscCents)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.prsiEeCents)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.aeEeCents)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{eur(l.liquidoCents)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">{eur(l.prsiErCents)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">{eur(l.custoEmpregadorCents)}</td>
                <td className="px-3 py-2">
                  {l.status === "final" ? <span className="chip-ok">{t("run.final")}</span>
                    : <span className="chip">{t("run.draft")}</span>}
                </td>
              </tr>
            ))}
            {!(d?.linhas ?? []).length && (
              <tr><td className="px-3 py-6 text-center text-muted" colSpan={10}>{t("run.nobody")}</td></tr>
            )}
          </tbody>
          {!!(d?.linhas ?? []).length && (
            <tfoot>
              <tr className="border-t-2 border-line font-semibold">
                <td className="px-3 py-2">{t("run.totals")}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.bruto)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.paye)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.usc)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.prsiEe)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.aeEe)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.liquido)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.prsiEr)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.custoEmpregador)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-3 max-w-3xl text-[12px] text-muted">{t("run.finaliseHelp")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button className="btn-ghost h-9 px-4 text-sm" disabled={ocupado} onClick={carregar}>
          {t("run.preview")}
        </button>
        {fechado ? (
          <button className="btn-ghost h-9 px-4 text-sm text-danger" disabled={ocupado}
            onClick={() => acao("reabrir")}>
            {t("run.reopen")}
          </button>
        ) : (
          <button className="btn-primary h-9 px-4 text-sm"
            disabled={ocupado || !(d?.linhas ?? []).length} onClick={() => acao("fechar")}>
            {ocupado ? "…" : t("run.finalise")}
          </button>
        )}
      </div>
    </div>
  );
}
