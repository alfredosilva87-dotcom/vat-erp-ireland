"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { hrYearOptions, useHrYear } from "@/components/hr/useHrYear";
import {
  bankHolidayFor, bankHolidaysOf, currentIsoWeek, grossFor, holidayBalance,
  holidayFor, holidayUnit, isHourly, isoWeeksInYear, isoWeekStart,
  type Employee, type WeekHours,
} from "@/lib/hr/payroll";
import EmployeeForm from "@/components/hr/EmployeeForm";
import PayrollRun from "@/components/hr/PayrollRun";
import ImportEmployees from "@/components/hr/ImportEmployees";

type Row = Employee & {
  id: string; first_name: string; surname: string | null;
  start_date: string | null; end_date: string | null;
  contract_type: string; bank_holiday_mode: string; data_source: string;
  job_title: string | null;
  freq_type: string; active: boolean; notes: string | null;
};
type HourRow = WeekHours & { employee_id: string; week_no: number };

const ABAS = ["employees", "hours", "gross", "holidays", "bank", "run", "import"] as const;
type Aba = (typeof ABAS)[number];

/**
 * A folha de uma empresa — as cinco abas do sistema de origem.
 *
 * Cada aba lê os MESMOS dados crus e passa-os pelas funções de
 * `lib/hr/payroll.ts`. Nenhuma soma acontece aqui: se o bruto fosse calculado
 * na tela, a aba "Bruto" e a aba "Feriados" acabariam a discordar sobre quanto
 * vale uma semana — e é exatamente esse o erro que ninguém confere.
 */
export default function CompanyPayroll({ params }: { params: { id: string } }) {
  const { t } = useT();
  const [year, setYear] = useHrYear();
  const [aba, setAba] = useState<Aba>("employees");
  const [dados, setDados] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // `null` = fechado · `{}` = a criar · `{...emp}` = a editar aquele.
  const [aEditar, setAEditar] = useState<any | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/hr/companies/${params.id}?year=${year}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error || "Falhou ao carregar.");
      setDados(await r.json());
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, [params.id, year]);

  useEffect(() => { load(); }, [load]);

  const employees: Row[] = dados?.employees ?? [];
  /*
   * So os blocos LIGADOS na empresa entram no formulario.
   *
   * Criar alguem "mensal" numa empresa que so corre semanal produz um
   * funcionario que nunca aparece em folha nenhuma — existe no cadastro e nao
   * existe em lado nenhum. O servidor tambem recusa; aqui nem se oferece.
   */
  const TODOS = ["weekly", "fortnightly", "monthly"] as const;
  /*
   * Os blocos LIGADOS vivem em `hr_client` (`freq_weekly`, `freq_fortnightly`,
   * `freq_monthly`) — e nao em `hr_client_config`, onde eu os fui procurar
   * primeiro. `hr_client_config` tem a CONFIGURACAO de cada bloco (dia de
   * emissao, offset, base da semana); nao diz quais estao ligados.
   *
   * Deu para nao reparar porque as duas coisas parecem a mesma de fora, e a
   * empresa de teste tinha linha em `hr_client_config` sem ter nenhum
   * `freq_*` — o que aliás e um estado que nao devia existir.
   */
  const configurados = TODOS.filter((b) => dados?.config?.[`freq_${b}`]);
  /*
   * Empresa SEM configuracao nenhuma oferece os tres.
   *
   * A maior parte das empresas do escritorio ainda nao tem linha em
   * `hr_client_config` — e nesse estado uma lista vazia deixava o formulario
   * sem bloco nenhum para escolher, ou seja, impossivel de submeter. Recusar
   * ali obrigava a uma ordem que ninguem adivinha (configurar antes de
   * admitir). O servidor faz a mesma leitura: so recusa quando HA configuracao
   * e o bloco escolhido nao esta nela.
   */
  const blocosDaEmpresa: ("weekly" | "fortnightly" | "monthly")[] =
    configurados.length ? configurados : [...TODOS];
  const horas: HourRow[] = dados?.hours ?? [];

  /** As horas de uma pessoa numa semana — a função que os cálculos recebem. */
  const horasDe = useMemo(() => {
    const mapa = new Map<string, HourRow>();
    for (const h of horas) mapa.set(`${h.employee_id}:${h.week_no}`, h);
    return (empId: string, week: number) => mapa.get(`${empId}:${week}`) ?? null;
  }, [horas]);

  const semanaAgora = currentIsoWeek();
  const totalSemanas = isoWeeksInYear(year);

  /** Acumulado do ano até agora, por pessoa. */
  const resumo = useMemo(() => {
    const out = new Map<string, { bruto: number; horas: number; semanas: number; feriasUsadas: number }>();
    for (const e of employees) {
      let bruto = 0, hs = 0, semanas = 0, usadas = 0;
      for (let w = 1; w <= totalSemanas; w++) {
        const h = horasDe(e.id, w);
        if (!h) continue;
        bruto += grossFor(e, h);
        hs += Number(h.hours ?? 0) + Number(h.sunday_hours ?? 0);
        if (h.week_worked) semanas++;
        usadas += Number(h.holiday_hours ?? 0);
      }
      // `opening_worked` é o que já foi trabalhado antes de o sistema existir:
      // horas para quem é pago à hora, semanas para contrato fixo. Sem isto,
      // entrar a meio do ano obrigava a lançar semana a semana desde janeiro.
      const abertura = Number(e.opening_worked ?? 0);
      out.set(e.id, {
        bruto,
        horas: hs + (isHourly(e) ? abertura : 0),
        semanas: semanas + (isHourly(e) ? 0 : abertura),
        feriasUsadas: usadas,
      });
    }
    return out;
  }, [employees, horasDe, totalSemanas]);

  const eur = (v: number) =>
    "€" + v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const n2 = (v: number) => v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nome = (e: Row) => [e.first_name, e.surname].filter(Boolean).join(" ");

  const feriadoDaSemana = useMemo(
    () => bankHolidaysOf(year).find((b) => b.week >= semanaAgora) ?? bankHolidaysOf(year)[0],
    [year, semanaAgora]
  );

  if (erro) {
    return (
      <div className="card p-8 text-center">
        <p className="text-muted">{erro}</p>
        <Link href="/hr/companies" className="btn-ghost mt-4 inline-flex">{t("common.back")}</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/hr/companies" className="text-sm text-brand-700">← {t("hr.navCompanies")}</Link>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
            {dados?.client?.name ?? t("common.loading")}
          </h1>
          <p className="mt-1 text-muted">
            <span className="font-mono text-xs">{dados?.client?.client_code}</span>
            {" · "}{t("hr.navPayroll")}
          </p>
        </div>
        <label className="flex flex-col leading-tight">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">
            {t("hr.yearLabel")}
          </span>
          <select
            className="input h-9 w-auto cursor-pointer py-0 text-[13px] font-semibold"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label={t("hr.yearLabel")}
          >
            {hrYearOptions().map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap gap-1 border-b border-line bg-surface-2/60 px-3 pt-2">
          {ABAS.map((a) => (
            <button
              key={a}
              onClick={() => setAba(a)}
              className={`subnav-item ${aba === a ? "subnav-item-active" : ""}`}
            >
              {t(("hr.tab_" + a) as any)}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          {/* ---------------------------------------------- Funcionários */}
          {aba === "employees" && (
            <table className="row-hover w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-medium">{t("hr.colStatus")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("hr.colEmployee")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("hr.colStart")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("hr.colContractType")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("hr.colPayType")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("hr.colRate")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("hr.colSundayRate")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("hr.colContractAmount")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("hr.colJobTitle")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("hr.colNote")}</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="border-b border-line/70">
                    <td className="px-4 py-2">
                      {e.active ? <span className="chip-ok">{t("common.active")}</span>
                        : <span className="chip bg-surface-2 text-muted">{t("common.inactive")}</span>}
                    </td>
                    <td className="px-4 py-2 font-medium">{nome(e)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted">{e.start_date || "—"}</td>
                    <td className="px-4 py-2 text-muted">{e.contract_type}</td>
                    <td className="px-4 py-2">{e.pay_type}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {isHourly(e) ? eur(Number(e.hourly_rate ?? 0)) : <span className="text-muted">n/a</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {isHourly(e) ? eur(Number(e.sunday_rate ?? 0)) : <span className="text-muted">n/a</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {isHourly(e) ? <span className="text-muted">n/a</span> : eur(Number(e.fixed_amount ?? 0))}
                    </td>
                    <td className="px-4 py-2">{e.job_title || <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-2 text-xs text-muted">{e.notes || "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <button className="text-[12px] underline" onClick={() => setAEditar(e)}>
                        {t("common.edit")}
                      </button>
                    </td>
                  </tr>
                ))}
                <Vazio n={employees.length} loading={loading} cols={11} texto={t("hr.noEmployees")} />
              </tbody>
            </table>
          )}

          {/*
            * ADMITIR ALGUEM — a accao que nao existia.
            *
            * O modulo so lia funcionarios: nao havia rota nem tela para criar
            * nenhum, e quem semeava era SQL directo. Fica ao pe da lista, que e
            * onde se descobre que falta uma pessoa.
            */}
          {aba === "employees" && (
            <div className="px-4 pb-4">
              {aEditar === null ? (
                <button className="btn-ghost mt-3 h-9 px-4 text-sm" onClick={() => setAEditar({})}>
                  + {t("hr.newEmployee")}
                </button>
              ) : (
                <EmployeeForm
                  clientId={params.id}
                  blocos={blocosDaEmpresa}
                  inicial={aEditar.id ? aEditar : null}
                  aoFechar={() => setAEditar(null)}
                  aoGravar={load}
                />
              )}
            </div>
          )}

          {aba === "import" && <ImportEmployees clientId={params.id} year={year} />}

          {/*
            * CORRER A FOLHA — a aba que fecha o ciclo.
            *
            * As cinco anteriores param no BRUTO, que e onde o sistema do
            * Matheus parava (o imposto dele vinha do CollSoft). Esta pega no
            * bruto e leva-o ate ao liquido e ao custo do patrao.
            */}
          {aba === "run" && (
            <PayrollRun clientId={params.id} year={year} freqType={blocosDaEmpresa[0] ?? "weekly"} />
          )}

          {/* ------------------------------------------- Horas / Bruto */}
          {(aba === "hours" || aba === "gross") && (
            <div className="-mx-1 overflow-x-auto px-1">
            <table className="row-hover w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="sticky left-0 bg-surface-2/60 px-4 py-2.5 font-medium">{t("hr.colEmployee")}</th>
                  {janela(semanaAgora, totalSemanas).map((w) => (
                    <th key={w} className="px-2 py-2.5 text-right font-medium">
                      {t("hr.weekShort")}{w}
                      <span className="block text-[9px] font-normal normal-case tracking-normal opacity-70">
                        {rotuloSemana(year, w)}
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right font-medium">{t("hr.colYearTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const r = resumo.get(e.id)!;
                  return (
                    <tr key={e.id} className="border-b border-line/70">
                      <td className="sticky left-0 bg-surface px-4 py-2 font-medium">
                        {nome(e)}
                        <span className="ml-2 chip bg-surface-2 text-[10px] text-muted">
                          {isHourly(e) ? t("hr.unitHours") : t("hr.unitMarked")}
                        </span>
                      </td>
                      {janela(semanaAgora, totalSemanas).map((w) => {
                        const h = horasDe(e.id, w);
                        if (aba === "gross") {
                          const g = grossFor(e, h);
                          return (
                            <td key={w} className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                              {g ? eur(g) : <span className="text-muted">—</span>}
                            </td>
                          );
                        }
                        const v = isHourly(e)
                          ? Number(h?.hours ?? 0) + Number(h?.sunday_hours ?? 0)
                          : h?.week_worked ? 1 : 0;
                        return (
                          <td key={w} className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                            {v ? n2(v) : <span className="text-muted">—</span>}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">
                        {aba === "gross" ? eur(r.bruto)
                          : isHourly(e) ? `${n2(r.horas)} h` : `${r.semanas} ${t("hr.unitWeeks")}`}
                      </td>
                    </tr>
                  );
                })}
                <Vazio n={employees.length} loading={loading} cols={12} texto={t("hr.noEmployees")} />
              </tbody>
            </table>
            </div>
          )}

          {/* ------------------------------------------------- Férias */}
          {aba === "holidays" && (
            <div className="-mx-1 overflow-x-auto px-1">
            <table className="row-hover w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-medium">{t("hr.colEmployee")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("hr.colUnit")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("hr.colOpening")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("hr.colAccrued")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("hr.colUsed")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("hr.colAvailable")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("hr.colRule")}</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const r = resumo.get(e.id)!;
                  const acumulado = holidayFor(e, r.horas, r.semanas);
                  const unidade = holidayUnit(e) === "hours" ? t("hr.unitH") : t("hr.unitDays");
                  return (
                    <tr key={e.id} className="border-b border-line/70">
                      <td className="px-4 py-2 font-medium">{nome(e)}</td>
                      <td className="px-4 py-2 text-muted">{unidade}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{n2(Number(e.holiday_opening ?? 0))}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{n2(acumulado)}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{n2(r.feriasUsadas)}</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums text-brand-700">
                        {n2(holidayBalance(e, acumulado, r.feriasUsadas))}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-muted">
                        {isHourly(e) ? t("hr.rule8pct") : t("hr.rule2052")}
                      </td>
                    </tr>
                  );
                })}
                <Vazio n={employees.length} loading={loading} cols={7} texto={t("hr.noEmployees")} />
              </tbody>
            </table>
            </div>
          )}

          {/* ---------------------------------------------- Feriados */}
          {aba === "bank" && (
            <div className="-mx-1 overflow-x-auto px-1">
            <table className="row-hover w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-medium">{t("hr.colEmployee")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("hr.colEntitled")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("hr.colWindow")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("hr.colWeeksWorked")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("hr.colTotalHours")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("hr.colAverage")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("hr.colDestination")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("hr.colToPay")}</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const bh = bankHolidayFor(e, feriadoDaSemana?.week ?? semanaAgora, horasDe);
                  return (
                    <tr key={e.id} className="border-b border-line/70">
                      <td className="px-4 py-2 font-medium">{nome(e)}</td>
                      <td className="px-4 py-2">
                        {bh.elegivel
                          ? <span className="chip-ok">{bh.automatico ? t("hr.bhAutomatic") : t("hr.bhPassed")}</span>
                          : <span className="chip-danger">{t("hr.bhFailed")}</span>}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted">S{bh.de}–S{bh.ate}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{bh.semanas} / 5</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {bh.automatico ? <span className="text-muted">—</span> : n2(bh.total)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {bh.automatico ? <span className="text-muted">—</span> : n2(bh.media)}
                      </td>
                      <td className="px-4 py-2">
                        <span className="chip bg-surface-2 text-muted">
                          {e.bank_holiday_mode === "Banked" ? t("hr.bhBanked") : t("hr.bhPaid")}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">
                        {eur(bh.pagarEuros)}
                        <span className="block text-[10px] font-normal text-muted">
                          {bh.automatico ? t("hr.bhFifthOfWeek") : t("hr.bhAvgOverFive")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                <Vazio n={employees.length} loading={loading} cols={8} texto={t("hr.noEmployees")} />
              </tbody>
            </table>
            </div>
          )}
        </div>

        <div className="border-t border-line bg-surface-2/60 px-4 py-2.5 text-xs text-muted">
          {aba === "holidays" && t("hr.holidayNote")}
          {aba === "bank" && t("hr.bankNote", { feriado: feriadoDaSemana?.name ?? "" })}
          {aba === "gross" && t("hr.grossNote")}
          {aba === "hours" && t("hr.hoursNote")}
          {aba === "employees" && t("hr.employeesNote")}
        </div>
      </div>
    </div>
  );
}

/**
 * As colunas mostradas: a semana atual e as anteriores que cabem.
 *
 * As 52 de uma vez dão uma tabela que ninguém lê e que rola de lado para
 * sempre. O sistema de origem resolvia isto com um seletor de mês; aqui a
 * janela segue a semana corrente, que é onde o trabalho está.
 */
function janela(atual: number, total: number): number[] {
  const fim = Math.min(total, Math.max(8, atual));
  const inicio = Math.max(1, fim - 7);
  return Array.from({ length: fim - inicio + 1 }, (_, i) => inicio + i);
}

function rotuloSemana(year: number, week: number): string {
  const a = isoWeekStart(year, week);
  const b = new Date(a);
  b.setUTCDate(b.getUTCDate() + 4); // segunda a sexta, como a folha é feita
  return `${a.getUTCDate()}–${b.getUTCDate()}`;
}

function Vazio({ n, loading, cols, texto }: { n: number; loading: boolean; cols: number; texto: string }) {
  if (n) return null;
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-10 text-center text-muted">
        {loading ? "…" : texto}
      </td>
    </tr>
  );
}
