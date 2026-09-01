"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { useHrYear } from "@/components/hr/useHrYear";
import { useHrCompanies } from "@/components/hr/useHrCompanies";
import WeekPicker from "@/components/hr/WeekPicker";
import {
  backlogWeeks, currentIsoWeek, dueInWeek, typeOnlyRos, typeSettled,
} from "@/lib/hr/payroll";

/**
 * O painel do RH: o que está atrasado, e o que vence agora.
 *
 * A unidade de contagem é o PAYROLL — uma empresa, numa semana, de um tipo —
 * e não a empresa. Uma casa que roda semanal e mensal na mesma semana tem dois
 * a sair, cada um com o seu ER, EE e ROS; contá-los como um só escondia metade
 * do trabalho. O comentário está aqui porque o número na tela parece "empresas"
 * e não é.
 */
export default function HrDashboard() {
  const { t } = useT();
  const [year, setYear] = useHrYear();
  const [week, setWeek] = useState(() => currentIsoWeek());
  const { companies, loading, erro } = useHrCompanies(year);

  const hoje = useMemo(() => ({ year: new Date().getFullYear(), week: currentIsoWeek() }), []);

  const modelo = useMemo(() => {
    const atrasadas = companies
      .map((c) => ({ c, b: backlogWeeks(c as any, year, week, hoje) }))
      .filter((x) => x.b.length)
      .sort((a, b) => a.b[0].week - b.b[0].week || a.c.name.localeCompare(b.c.name));

    /*
     * O prato junta o que vence AGORA e o que ficou por fechar antes. Um atraso
     * nunca está concluído: por definição entra do lado aberto.
     */
    const prato = [
      ...companies.flatMap((c) =>
        dueInWeek(c as any, year, week, hoje).map((d) => ({
          c, week, type: d.type, arrastado: false,
        }))
      ),
      ...atrasadas.flatMap(({ c, b }) =>
        b.map((x) => ({ c, week: x.week, type: x.type, arrastado: true }))
      ),
    ];

    const feitos = prato.filter((p) => typeSettled(p.c as any, p.week, p.type)).length;
    const soRos = prato.filter((p) => typeOnlyRos(p.c as any, p.week, p.type)).length;

    return {
      atrasadas,
      total: prato.length,
      feitos,
      pendentes: prato.length - feitos,
      soRos,
      arrastados: prato.filter((p) => p.arrastado).length,
      pessoas: companies.reduce((s, c) => s + c.employee_count, 0),
    };
  }, [companies, year, week, hoje]);

  const pct = modelo.total ? Math.round((modelo.feitos / modelo.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{t("hr.title")}</h1>
          <p className="mt-1 text-muted">{t("hr.dashSubtitle")}</p>
        </div>
        <WeekPicker year={year} week={week} onWeek={setWeek} onYear={setYear} />
      </div>

      {erro && <p className="text-sm text-danger">{erro}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Cartao rotulo={t("hr.cardCompanies")} valor={companies.length} nota={t("hr.cardCompaniesSub")} />
        <Cartao
          rotulo={t("hr.cardDue")} valor={modelo.total} destaque
          nota={modelo.arrastados ? t("hr.cardCarried", { n: modelo.arrastados }) : t("hr.cardNothingCarried")}
        />
        <Cartao rotulo={t("hr.cardDone")} valor={modelo.feitos} tom="ok" nota={t("hr.cardDonePct", { n: pct })} />
        <Cartao rotulo={t("hr.cardPending")} valor={modelo.pendentes} tom="danger" nota={t("hr.cardPendingSub")} />
        <Cartao rotulo={t("hr.cardOnlyRos")} valor={modelo.soRos} tom="warn" nota={t("hr.cardOnlyRosSub")} />
        <Cartao rotulo={t("hr.cardStaff")} valor={modelo.pessoas} nota={t("hr.cardStaffSub")} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-2/60 px-4 py-2.5">
          <h2 className="font-display text-sm font-semibold">{t("hr.behindTitle")}</h2>
          <span className="text-xs text-muted">{t("hr.behindSub")}</span>
          <Link href="/hr/weekly" className="btn-ghost ml-auto h-8 px-3 text-xs">
            {t("hr.navWeekly")} →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">{t("hr.colId")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colCompany")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colSince")}</th>
                <th className="px-4 py-2.5 text-center font-medium">{t("hr.colOpenWeeks")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colMissing")}</th>
              </tr>
            </thead>
            <tbody>
              {modelo.atrasadas.map(({ c, b }) => (
                <tr key={c.id} className="border-b border-line/70">
                  <td className="px-4 py-2 font-mono text-xs text-muted">{c.client_code}</td>
                  <td className="px-4 py-2 font-medium">
                    <Link href={`/hr/companies/${c.id}`} className="hover:text-brand-700">{c.name}</Link>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{t("hr.week")} {b[0].week}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={b.length > 2 ? "chip-danger" : "chip-warn"}>{b.length}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">
                    {Array.from(new Set(b.flatMap((x) => x.open)))
                      .map((k) => t(("hr.field_" + k) as any)).join(" · ")}
                  </td>
                </tr>
              ))}
              {!modelo.atrasadas.length && !loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted">{t("hr.nothingBehind")}</td>
                </tr>
              )}
              {loading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">{t("common.loading")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Cartao({
  rotulo, valor, nota, tom, destaque,
}: {
  rotulo: string; valor: number; nota?: string;
  tom?: "ok" | "warn" | "danger"; destaque?: boolean;
}) {
  const cor =
    tom === "ok" ? "text-success" :
    tom === "warn" ? "text-warning" :
    tom === "danger" ? "text-danger" :
    destaque ? "text-brand-700" : "";
  return (
    <div className="card p-4">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{rotulo}</div>
      <div className={`mt-0.5 font-display text-2xl font-semibold tabular-nums ${cor}`}>{valor}</div>
      {nota && <div className="mt-0.5 text-xs text-muted">{nota}</div>}
    </div>
  );
}
