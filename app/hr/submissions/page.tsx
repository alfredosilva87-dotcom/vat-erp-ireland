"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { currentIsoWeek } from "@/lib/hr/payroll";

type Submission = {
  id: string; client_id: string; client_name: string | null; client_code: string | null;
  employee_name: string | null; year: number; week_no: number;
  hours: number | null; sunday_hours: number | null; holiday_hours: number | null;
  week_worked: boolean | null; note: string | null;
  submitted_by: string | null; submitted_at: string;
};

/**
 * As horas que o cliente mandou, à espera de conferência.
 *
 * Nada disto tocou nas horas oficiais. O que o cliente manda é um PEDIDO de
 * lançamento: fica aqui, fora de toda conta, até alguém do escritório aprovar.
 * É por isso que a tabela é outra (`hr_hour_submissions`) e não uma coluna de
 * "pendente" nas horas — o cliente nunca escreve na tabela oficial, nem por
 * engano, e o pior que um erro dele produz é uma linha errada nesta fila.
 */
export default function HrSubmissions() {
  const { t } = useT();
  const [linhas, setLinhas] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/hr/submissions", { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error || "Falhou ao carregar.");
      setLinhas((await r.json()).submissions || []);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const semanaAgora = currentIsoWeek();
  const anoAgora = new Date().getFullYear();
  const passada = (s: Submission) => s.year < anoAgora || (s.year === anoAgora && s.week_no < semanaAgora);
  const atrasadas = linhas.filter(passada).length;
  const empresas = new Set(linhas.map((s) => s.client_id)).size;

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t("hr.navSubmissions")}</h1>
        <p className="mt-1 text-muted">{t("hr.submissionsSubtitle")}</p>
      </div>

      {erro && <p className="text-sm text-danger">{erro}</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("hr.subWaiting")}</div>
          <div className="mt-0.5 font-display text-2xl font-semibold tabular-nums text-brand-700">{linhas.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("hr.subCompanies")}</div>
          <div className="mt-0.5 font-display text-2xl font-semibold tabular-nums">{empresas}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("hr.subPastWeek")}</div>
          <div className={`mt-0.5 font-display text-2xl font-semibold tabular-nums ${atrasadas ? "text-danger" : ""}`}>
            {atrasadas}
          </div>
          {atrasadas > 0 && <div className="mt-0.5 text-xs text-muted">{t("hr.subLookTwice")}</div>}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-line bg-surface-2/60 px-4 py-2.5">
          <h2 className="font-display text-sm font-semibold">{t("hr.subQueue")}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">{t("hr.colCompany")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colEmployee")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colWeek")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("hr.colHours")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("hr.colSunday")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("hr.colHoliday")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colSentBy")}</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((s) => (
                <tr key={s.id} className="border-b border-line/70">
                  <td className="px-4 py-2 font-medium">
                    <span className="font-mono text-xs text-muted">{s.client_code} </span>
                    {s.client_name || "—"}
                  </td>
                  <td className="px-4 py-2">{s.employee_name || "—"}</td>
                  <td className="px-4 py-2">
                    {passada(s)
                      ? <span className="chip-danger">{t("hr.week")} {s.week_no} · {t("hr.subGone")}</span>
                      : <span className="chip-ok">{t("hr.week")} {s.week_no}</span>}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{s.hours ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{s.sunday_hours ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{s.holiday_hours ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">{s.submitted_by || "—"}</td>
                </tr>
              ))}
              {!linhas.length && !loading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">{t("hr.subEmpty")}</td></tr>
              )}
              {loading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">{t("common.loading")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line bg-surface-2/60 px-4 py-2.5 text-xs text-muted">
          {t("hr.subNotOfficial")}
        </div>
      </div>
    </div>
  );
}
