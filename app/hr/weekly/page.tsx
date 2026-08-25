"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { useHrYear } from "@/components/hr/useHrYear";
import { useHrCompanies } from "@/components/hr/useHrCompanies";
import WeekPicker from "@/components/hr/WeekPicker";
import {
  BLANK_WEEK, backlogWeeks, cellOf, currentIsoWeek, dueInWeek, typeSettled,
  type CellState, type WeekCell,
} from "@/lib/hr/payroll";

/**
 * O controlo semanal: o que tem de sair esta semana, empresa a empresa.
 *
 * Uma linha por PAYROLL, não por empresa. A casa que roda semanal e mensal na
 * mesma semana aparece duas vezes, porque são dois envios com ER, EE e ROS
 * próprios — juntá-los numa linha fazia fechar um dar o outro por fechado.
 */

/** Cada clique percorre os quatro estados, na ordem do sistema de origem. */
const CICLO: CellState[] = ["na", "pending", "done", "skip"];
const proximo = (v: CellState): CellState => CICLO[(CICLO.indexOf(v) + 1) % CICLO.length];

const CAMPOS = ["payslip", "er", "ee", "ros"] as const;

export default function HrWeekly() {
  const { t, lang } = useT();
  const [year, setYear] = useHrYear();
  const [week, setWeek] = useState(() => currentIsoWeek());
  const { companies, loading, erro, reload } = useHrCompanies(year);
  const [gravando, setGravando] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const hoje = useMemo(() => ({ year: new Date().getFullYear(), week: currentIsoWeek() }), []);

  /** As linhas da semana: uma por empresa × tipo que vence agora. */
  const linhas = useMemo(
    () =>
      companies.flatMap((c) =>
        dueInWeek(c as any, year, week, hoje).map((d) => ({
          c,
          due: d,
          cell: cellOf(c as any, week, d.type) ?? BLANK_WEEK,
          atraso: backlogWeeks(c as any, year, week, hoje).length,
          fechado: typeSettled(c as any, week, d.type),
        }))
      ),
    [companies, year, week, hoje]
  );

  const feitos = linhas.filter((l) => l.fechado).length;

  /**
   * O que o payslip cobre, escrito no idioma da tela.
   *
   * O nome do mês sai de `Intl` com o idioma corrente em vez de doze chaves de
   * tradução por idioma: são doze palavras que todo sistema operativo já sabe
   * dizer, e uma lista dessas envelhece sozinha quando entra um idioma novo.
   */
  const cobre = (d: (typeof linhas)[number]["due"]): string => {
    if (d.type === "weekly") return `${t("hr.week")} ${d.ownWeek}`;
    if (d.type === "fortnightly")
      return `${t("hr.period")} ${d.period} · ${t("hr.weekShort")}${d.periodWeeks?.[0]}+${d.periodWeeks?.[1]}`;
    const mes = new Date(Date.UTC(year, d.month ?? 0, 15));
    return mes.toLocaleDateString(lang, { month: "long", timeZone: "UTC" });
  };

  async function marcar(clientId: string, freqType: string, campo: string, atual: CellState) {
    const chave = `${clientId}:${freqType}:${campo}`;
    setGravando(chave);
    setMsg(null);
    try {
      const r = await fetch("/api/hr/weeks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId, year, week_no: week, freq_type: freqType,
          field: campo, value: proximo(atual),
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Falhou ao gravar.");
      await reload();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setGravando(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{t("hr.navWeekly")}</h1>
          <p className="mt-1 text-muted">{t("hr.weeklySubtitle")}</p>
        </div>
        <WeekPicker year={year} week={week} onWeek={setWeek} onYear={setYear} />
      </div>

      {erro && <p className="text-sm text-danger">{erro}</p>}
      {msg && <p className="text-sm text-danger">{msg}</p>}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-2/60 px-4 py-2.5">
          <h2 className="font-display text-sm font-semibold">
            {t("hr.weeklyCount", { n: linhas.length })}
          </h2>
          <span className="text-xs text-muted">
            {t("hr.weeklyDone", { n: feitos, total: linhas.length })}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">{t("hr.colId")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colCompany")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colType")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colCovers")}</th>
                {CAMPOS.map((k) => (
                  <th key={k} className="px-2 py-2.5 text-center font-medium">
                    {t(("hr.field_" + k) as any)}
                  </th>
                ))}
                <th className="px-4 py-2.5 font-medium">{t("hr.colBacklog")}</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={`${l.c.id}:${l.due.type}`} className="border-b border-line/70">
                  <td className="px-4 py-2 font-mono text-xs text-muted">{l.c.client_code}</td>
                  <td className="px-4 py-2 font-medium">
                    <Link href={`/hr/companies/${l.c.id}`} className="hover:text-brand-700">{l.c.name}</Link>
                  </td>
                  <td className="px-4 py-2">
                    <span className="chip bg-brand-50 text-brand-700">
                      {t(("hr.freq" + l.due.type[0].toUpperCase() + l.due.type.slice(1)) as any)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">{cobre(l.due)}</td>
                  {CAMPOS.map((k) => (
                    <td key={k} className="px-2 py-2 text-center">
                      <Estado
                        valor={l.cell[k as keyof WeekCell]}
                        ocupado={gravando === `${l.c.id}:${l.due.type}:${k}`}
                        onClick={() => marcar(l.c.id, l.due.type, k, l.cell[k as keyof WeekCell])}
                        rotulo={t(("hr.field_" + k) as any)}
                      />
                    </td>
                  ))}
                  <td className="px-4 py-2">
                    {l.atraso
                      ? <span className="chip-danger">{t("hr.behindWeeks", { n: l.atraso })}</span>
                      : <span className="chip-ok">{t("hr.upToDate")}</span>}
                  </td>
                </tr>
              ))}
              {!linhas.length && !loading && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">{t("hr.nothingDue")}</td></tr>
              )}
              {loading && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">{t("common.loading")}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/*
          A legenda não é enfeite: "–" e "n/a" desenham-se parecidos e querem
          dizer o oposto um do outro. O primeiro é resposta que falta e mantém
          a empresa na fila; o segundo é uma decisão, e fecha a semana.
        */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-4 py-2.5 text-xs text-muted">
          <span className="flex items-center gap-1.5"><Bolha valor="na" />{t("hr.legendNa")}</span>
          <span className="flex items-center gap-1.5"><Bolha valor="pending" />{t("hr.legendPending")}</span>
          <span className="flex items-center gap-1.5"><Bolha valor="done" />{t("hr.legendDone")}</span>
          <span className="flex items-center gap-1.5"><Bolha valor="skip" />{t("hr.legendSkip")}</span>
        </div>
      </div>
    </div>
  );
}

const SIMBOLO: Record<CellState, string> = { na: "–", pending: "✕", done: "✓", skip: "n/a" };
const CLASSE: Record<CellState, string> = {
  na: "border-line bg-surface-2 text-muted",
  pending: "border-transparent bg-danger-50 text-danger",
  done: "border-transparent bg-success-50 text-success",
  skip: "border-line bg-surface-2 text-muted text-[9px]",
};

function Bolha({ valor }: { valor: CellState }) {
  return (
    <span className={`inline-grid h-5 w-5 place-items-center rounded-md border text-[11px] font-bold ${CLASSE[valor]}`}>
      {SIMBOLO[valor]}
    </span>
  );
}

function Estado({
  valor, onClick, ocupado, rotulo,
}: {
  valor: CellState; onClick: () => void; ocupado: boolean; rotulo: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={ocupado}
      title={`${rotulo}: ${SIMBOLO[valor]}`}
      aria-label={`${rotulo}: ${SIMBOLO[valor]}`}
      className={`inline-grid h-6 w-6 place-items-center rounded-md border text-xs font-bold transition-colors disabled:opacity-50 ${CLASSE[valor]}`}
    >
      {SIMBOLO[valor]}
    </button>
  );
}
