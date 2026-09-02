"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { hrYearOptions, useHrYear } from "@/components/hr/useHrYear";
import { useHrCompanies } from "@/components/hr/useHrCompanies";
import { diaDaSemana, origemDasHoras } from "@/components/hr/labels";

/**
 * As empresas que fazem folha.
 *
 * Não é um segundo cadastro de clientes: nome, código e contacto vêm do
 * cadastro raiz do ERP e aqui são só LIDOS. O que esta tela mostra por cima é
 * a configuração de folha — que tipos de payslip a empresa roda, em que dia
 * saem, de onde vêm as horas. Cliente novo entra uma vez, em Clientes.
 */
export default function HrCompanies() {
  const { t, lang } = useT();
  const [year, setYear] = useHrYear();
  const { companies, foraDaFolha, loading, erro, reload } = useHrCompanies(year);
  const [busca, setBusca] = useState("");
  /*
   * Quais blocos ligar em cada empresa que vai entrar.
   *
   * Nasce com os blocos que os funcionarios JA existentes usam: quem tem seis
   * semanais e um mensal quer os dois ligados, e obrigar a redescobrir isso a
   * mao e trabalho que o sistema ja sabe fazer.
   */
  const [aEntrar, setAEntrar] = useState<Record<string, string[]>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  const blocosDe = (c: (typeof foraDaFolha)[number]) =>
    aEntrar[c.id] ?? (c.blocos.length ? c.blocos : ["weekly"]);

  async function entrar(c: (typeof foraDaFolha)[number]) {
    setOcupado(c.id); setFalha(null);
    try {
      const r = await fetch("/api/hr/companies", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: c.id, blocos: blocosDe(c) }),
      });
      const j = await r.json();
      if (!r.ok) { setFalha(j.error || "Falhou."); return; }
      await reload();
    } finally { setOcupado(null); }
  }

  const filtradas = companies.filter((c) =>
    !busca.trim() ||
    `${c.client_code} ${c.name} ${c.contact_person ?? ""}`.toLowerCase().includes(busca.toLowerCase())
  );

  const tipos = (c: (typeof companies)[number]) =>
    [
      c.freq_weekly && t("hr.freqWeekly"),
      c.freq_fortnightly && t("hr.freqFortnightly"),
      c.freq_monthly && t("hr.freqMonthly"),
    ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{t("hr.navCompanies")}</h1>
          <p className="mt-1 text-muted">{t("hr.companiesSubtitle")}</p>
        </div>
        <div className="flex items-end gap-3">
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
          <Link href="/clients" className="btn-ghost">{t("hr.openClientRegister")} →</Link>
        </div>
      </div>

      {erro && <p className="text-sm text-danger">{erro}</p>}

      {/*
        * QUEM AINDA NAO ENTROU NA FOLHA.
        *
        * Uma empresa so aparece no modulo quando tem linha em `hr_client`, e
        * nada no produto criava essa linha — quem semeava era SQL. O sintoma
        * era o pior possivel: a lista abria VAZIA, sem erro nenhum, e de fora
        * parecia que as telas nao existiam.
        *
        * Quando a empresa JA TEM gente, isto deixa de ser uma sugestao e passa
        * a ser um aviso: sao funcionarios cadastrados que nao estao a servir
        * para nada, e ninguem ia a procura da causa.
        */}
      {!!foraDaFolha.length && (
        <div className="card overflow-hidden">
          <div className="border-b border-line bg-surface-2/60 px-4 py-2.5">
            <h2 className="font-display text-sm font-semibold">
              {t("hr.offPayroll", { n: foraDaFolha.length })}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-muted">{t("hr.offPayrollHelp")}</p>
          </div>
          {falha && <p className="px-4 py-2 text-sm text-danger">{falha}</p>}
          <div className="divide-y divide-line/70">
            {foraDaFolha.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-48 flex-1">
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-2 font-mono text-xs text-muted">{c.client_code}</span>
                  {c.employee_count > 0 && (
                    <p className="mt-0.5 text-[12px] text-warning">
                      {t("hr.offPayrollHasStaff", { n: c.employee_count })}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
                  {(["weekly", "fortnightly", "monthly"] as const).map((b) => (
                    <label key={b} className="flex cursor-pointer items-center gap-1.5">
                      <input type="checkbox" checked={blocosDe(c).includes(b)}
                        onChange={(e) => setAEntrar((m) => ({
                          ...m,
                          [c.id]: e.target.checked
                            ? [...blocosDe(c), b]
                            : blocosDe(c).filter((x) => x !== b),
                        }))} />
                      {t(b === "weekly" ? "hr.freqWeekly"
                        : b === "fortnightly" ? "hr.freqFortnightly" : "hr.freqMonthly")}
                    </label>
                  ))}
                  <button className="btn-primary h-8 px-3 text-xs"
                    disabled={ocupado === c.id || !blocosDe(c).length}
                    onClick={() => entrar(c)}>
                    {ocupado === c.id ? "…" : t("hr.putOnPayroll")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-2/60 px-4 py-2.5">
          <h2 className="font-display text-sm font-semibold">
            {t("hr.companiesCount", { n: filtradas.length })}
          </h2>
          <input
            className="input ml-auto h-8 w-56 text-xs"
            placeholder={t("hr.searchCompany")}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">{t("hr.colId")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colStatus")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colCompany")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colContact")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("hr.colStaff")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colPayslipType")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colIssueDay")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colHoursSource")}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => (
                <tr key={c.id} className="border-b border-line/70">
                  <td className="px-4 py-2 font-mono text-xs text-muted">{c.client_code}</td>
                  <td className="px-4 py-2">
                    {c.status === "Inactive"
                      ? <span className="chip bg-surface-2 text-muted">{t("common.inactive")}</span>
                      : <span className="chip-ok">{t("common.active")}</span>}
                  </td>
                  <td className="px-4 py-2 font-medium">{c.name}</td>
                  <td className="px-4 py-2 text-muted">{c.contact_person || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{c.employee_count}</td>
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap gap-1">
                      {tipos(c).length
                        ? tipos(c).map((x) => (
                            <span key={x} className="chip bg-brand-50 text-brand-700">{x}</span>
                          ))
                        : <span className="text-muted">—</span>}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted">{diaDaSemana(c.pay_day, lang)}</td>
                  <td className="px-4 py-2 text-muted">{origemDasHoras(c.hours_source, t)}</td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/hr/companies/${c.id}`} className="btn-ghost h-8 px-3 text-xs">
                      {t("hr.openPayroll")}
                    </Link>
                  </td>
                </tr>
              ))}
              {!filtradas.length && !loading && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">{t("hr.noCompanies")}</td></tr>
              )}
              {loading && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">{t("common.loading")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
