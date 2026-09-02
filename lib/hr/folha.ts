import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { tabelaDoBanco } from "@/lib/hr/fiscal/tabelasDb";
import { calcular, type Base, type Situacao } from "@/lib/hr/fiscal/motor";
import { grossFor, isoWeekStart, type Employee, type WeekHours } from "@/lib/hr/payroll";

/**
 * CORRER A FOLHA de um cliente num período.
 *
 * Junta as três peças que já existiam soltas:
 *
 *   `lib/hr/payroll.ts`      → o BRUTO (horas × taxa, ou contrato rateado)
 *   `lib/hr/fiscal/motor.ts` → o IMPOSTO sobre esse bruto
 *   `hr_payslip`             → o FACTO gravado, que alimenta o acumulado
 *
 * ---------------------------------------------------------------------------
 * O ACUMULADO VEM DOS PAYSLIPS FECHADOS, E SÓ DELES
 *
 * Um rascunho calcula-se as vezes que forem precisas e não mexe no acumulado de
 * ninguém. Se contasse, abrir a tela duas vezes somava duas vezes — e a segunda
 * folha vinha errada sem nada a apontar a causa.
 *
 * ---------------------------------------------------------------------------
 * E O ACUMULADO É O DO ANO, NÃO O DA VIDA
 *
 * O `ytd_opening_*` do funcionário só entra quando `ytd_opening_year` é o ano
 * que se está a correr. Sem esse filtro, o acumulado de 2025 entrava na folha
 * de 2026 e a pessoa levava um ano inteiro de imposto devolvido de uma vez.
 */

export type LinhaDaFolha = {
  employeeId: string;
  nome: string;
  jobTitle: string | null;
  freqType: "weekly" | "fortnightly" | "monthly";
  brutoCents: number;
  payeCents: number;
  uscCents: number;
  prsiEeCents: number;
  prsiErCents: number;
  liquidoCents: number;
  custoEmpregadorCents: number;
  acumulado: { bruto: number; paye: number; usc: number; prsi: number };
  aplicado: { cutOff: number; creditos: number; base: Base };
  avisos: string[];
  /** Já fechado? Então não se recalcula por cima. */
  status: "draft" | "final" | null;
};

export type Folha = {
  clientId: string;
  year: number;
  periodNo: number;
  freqType: "weekly" | "fortnightly" | "monthly";
  payDate: string;
  linhas: LinhaDaFolha[];
  totais: {
    bruto: number; paye: number; usc: number; prsiEe: number; prsiEr: number;
    liquido: number; custoEmpregador: number;
  };
  /** O que impede esta folha de ser tomada por definitiva. */
  avisos: string[];
};

const PERIODOS: Record<string, 52 | 26 | 12> = { weekly: 52, fortnightly: 26, monthly: 12 };

/**
 * As semanas ISO que um período cobre.
 *
 * O livro de horas é SEMPRE semanal — é assim no sistema do Matheus e é assim
 * aqui. Uma quinzena são duas semanas, um mês são as semanas cuja quinta-feira
 * cai nele (a mesma regra que decide a que mês pertence uma semana ISO).
 */
export function semanasDoPeriodo(
  freq: "weekly" | "fortnightly" | "monthly", ano: number, periodo: number
): number[] {
  if (freq === "weekly") return [periodo];
  if (freq === "fortnightly") return [periodo * 2 - 1, periodo * 2];
  const semanas: number[] = [];
  for (let w = 1; w <= 53; w++) {
    const inicio = isoWeekStart(ano, w);
    if (!inicio) continue;
    // Quinta-feira da semana: é ela que decide o mês a que a semana pertence.
    const quinta = new Date(inicio);
    quinta.setUTCDate(quinta.getUTCDate() + 3);
    if (quinta.getUTCFullYear() === ano && quinta.getUTCMonth() + 1 === periodo) semanas.push(w);
  }
  return semanas;
}

export async function correrFolha(args: {
  clientId: string;
  year: number;
  periodNo: number;
  freqType: "weekly" | "fortnightly" | "monthly";
  payDate?: string;
}): Promise<Folha> {
  const sb = getServerSupabase();
  const { year, periodNo, freqType } = args;
  const semanas = semanasDoPeriodo(freqType, year, periodNo);

  /*
   * A DATA DE PAGAMENTO escolhe a tabela e a linha de PRSI, e por isso não pode
   * ser "hoje" por omissão numa folha antiga: recalcular Setembro em Dezembro
   * passaria a usar a tabela de Dezembro.
   */
  const payDate = args.payDate
    ?? (isoWeekStart(year, semanas[semanas.length - 1] ?? 1)?.toISOString().slice(0, 10)
      ?? `${year}-01-01`);

  const { tabela, deFabrica } = await tabelaDoBanco(Number(payDate.slice(0, 4)));

  const [{ data: emps }, { data: horas }, { data: fechados }] = await Promise.all([
    sb.from("hr_employees").select("*")
      .eq("client_id", args.clientId).eq("freq_type", freqType).eq("active", true)
      .order("first_name"),
    sb.from("hr_employee_hours").select("*").eq("year", year),
    sb.from("hr_payslip").select("*")
      .eq("client_id", args.clientId).eq("year", year).eq("freq_type", freqType),
  ]);

  const funcionarios = ((emps ?? []) as any[]);
  const porFuncionario = new Map<string, any[]>();
  for (const h of ((horas ?? []) as any[])) {
    const a = porFuncionario.get(h.employee_id) ?? [];
    a.push(h); porFuncionario.set(h.employee_id, a);
  }
  const payslips = ((fechados ?? []) as any[]);

  const avisos: string[] = [];
  if (deFabrica) {
    avisos.push(
      `Nao ha tabela fiscal cadastrada para ${payDate.slice(0, 4)}; foi usada a de fabrica. `
        + "Cadastre-a em RH -> Tabelas fiscais."
    );
  }

  const linhas: LinhaDaFolha[] = funcionarios.map((e) => {
    // ---- 1. o BRUTO, pelas funções que já existiam
    const doPeriodo = (porFuncionario.get(e.id) ?? []).filter((h) => semanas.includes(h.week_no));
    const brutoCents = doPeriodo.reduce(
      (s, h) => s + Math.round(grossFor(e as Employee, h as WeekHours) * 100), 0
    );

    /*
     * ---- 2. o ACUMULADO ANTES deste período
     *
     * Só payslips FECHADOS de períodos ANTERIORES, mais a abertura do ano.
     * Incluir o próprio período faria a folha somar-se a si mesma ao ser
     * recalculada.
     */
    const anteriores = payslips.filter((p) => p.status === "final" && p.period_no < periodNo);
    const aberturaDoAno = Number(e.ytd_opening_year) === year;
    const acumuladoAnterior = {
      bruto: (aberturaDoAno ? Number(e.ytd_opening_gross_cents) || 0 : 0)
        + anteriores.filter((p) => p.employee_id === e.id).reduce((s, p) => s + Number(p.gross_cents), 0),
      paye: (aberturaDoAno ? Number(e.ytd_opening_paye_cents) || 0 : 0)
        + anteriores.filter((p) => p.employee_id === e.id).reduce((s, p) => s + Number(p.paye_cents), 0),
      usc: (aberturaDoAno ? Number(e.ytd_opening_usc_cents) || 0 : 0)
        + anteriores.filter((p) => p.employee_id === e.id).reduce((s, p) => s + Number(p.usc_cents), 0),
      prsiEmpregado: (aberturaDoAno ? Number(e.ytd_opening_prsi_cents) || 0 : 0)
        + anteriores.filter((p) => p.employee_id === e.id).reduce((s, p) => s + Number(p.prsi_ee_cents), 0),
    };

    // ---- 3. o IMPOSTO
    const r = calcular({
      brutoPeriodo: brutoCents,
      dataPagamento: payDate,
      periodosNoAno: PERIODOS[freqType],
      periodoNo: periodNo,
      base: (e.tax_basis || "cumulativa") as Base,
      situacao: (e.marital_status || "solteiro") as Situacao,
      rpn: e.rpn_cutoff_cents !== null || e.rpn_credits_cents !== null
        ? {
          cutOffAnual: e.rpn_cutoff_cents === null ? undefined : Number(e.rpn_cutoff_cents),
          creditosAnuais: e.rpn_credits_cents === null ? undefined : Number(e.rpn_credits_cents),
        }
        : null,
      acumuladoAnterior,
      uscReduzido: !!e.usc_reduced,
      isentoUSC: !!e.usc_exempt,
      classePRSI: e.prsi_class,
    }, tabela);

    const jaGravado = payslips.find((p) => p.employee_id === e.id && p.period_no === periodNo);

    const proprios = [...r.avisos];
    if (!e.pps_number) proprios.push("Sem PPS: esta folha nao se pode submeter a Revenue.");

    /*
     * O BURACO NO ACUMULADO — o aviso mais importante desta tela.
     *
     * Na base cumulativa o imposto sai do ano ATE AQUI. Correr a semana 30 sem
     * ter fechado as 29 anteriores da um acumulado quase vazio, e portanto um
     * PAYE quase zero: o sistema conclui que a pessoa ganhou 660 euros o ano
     * todo, quando na verdade ganhou 30 semanas disso.
     *
     * O numero sai PLAUSIVEL — nao da erro nenhum, e ninguem desconfia de um
     * imposto baixo. So se descobre quando a Revenue emite a conta.
     *
     * Conta-se pelas semanas COM HORAS, e nao pelo numero do periodo: quem
     * entrou em Junho nao tem buraco nenhum em Janeiro, e acusa-lo ali seria um
     * alarme que grita sempre.
     */
    const base = (e.tax_basis || "cumulativa") as Base;
    if (base === "cumulativa" && periodNo > 1) {
      const fechadosDele = new Set(
        anteriores.filter((p) => p.employee_id === e.id).map((p) => Number(p.period_no))
      );
      const comHoras = new Set(
        (porFuncionario.get(e.id) ?? [])
          .filter((h) => Number(h.hours) > 0 || Number(h.sunday_hours) > 0 || h.week_worked)
          .map((h) => Number(h.week_no))
      );
      const buracos: number[] = [];
      for (let p = 1; p < periodNo; p++) {
        if (fechadosDele.has(p)) continue;
        if (semanasDoPeriodo(freqType, year, p).some((w) => comHoras.has(w))) buracos.push(p);
      }
      if (buracos.length && !aberturaDoAno) {
        proprios.push(
          `${buracos.length} periodo(s) anteriores com horas e SEM folha fechada `
            + `(${buracos.slice(0, 6).join(", ")}${buracos.length > 6 ? "…" : ""}). `
            + "Na base cumulativa isso da um imposto baixo a mais: feche-os primeiro, "
            + "ou preencha o acumulado de abertura no cadastro."
        );
      }
    }

    return {
      employeeId: e.id,
      nome: [e.first_name, e.surname].filter(Boolean).join(" "),
      jobTitle: e.job_title ?? null,
      freqType,
      brutoCents,
      payeCents: r.paye,
      uscCents: r.usc,
      prsiEeCents: r.prsiEmpregado,
      prsiErCents: r.prsiEmpregador,
      liquidoCents: r.liquido,
      custoEmpregadorCents: r.custoEmpregador,
      acumulado: {
        bruto: r.acumulado.bruto, paye: r.acumulado.paye,
        usc: r.acumulado.usc, prsi: r.acumulado.prsiEmpregado,
      },
      aplicado: {
        cutOff: r.aplicado.cutOffPeriodo,
        creditos: r.aplicado.creditosPeriodo,
        base: r.aplicado.base,
      },
      avisos: proprios,
      status: jaGravado?.status ?? null,
    };
  });

  const soma = (f: (l: LinhaDaFolha) => number) => linhas.reduce((s, l) => s + f(l), 0);

  return {
    clientId: args.clientId, year, periodNo, freqType, payDate, linhas,
    totais: {
      bruto: soma((l) => l.brutoCents),
      paye: soma((l) => l.payeCents),
      usc: soma((l) => l.uscCents),
      prsiEe: soma((l) => l.prsiEeCents),
      prsiEr: soma((l) => l.prsiErCents),
      liquido: soma((l) => l.liquidoCents),
      custoEmpregador: soma((l) => l.custoEmpregadorCents),
    },
    avisos,
  };
}

/**
 * FECHAR a folha: grava cada linha como payslip `final`.
 *
 * A partir daqui o número entra no acumulado dos períodos seguintes e deixa de
 * se poder alterar — o gatilho da migração 050 recusa. Reabrir é um acto
 * próprio, e não um efeito lateral de voltar a esta tela.
 */
export async function fecharFolha(args: {
  clientId: string; year: number; periodNo: number;
  freqType: "weekly" | "fortnightly" | "monthly";
  payDate?: string; userId?: string | null;
}): Promise<{ ok: boolean; erro?: string; gravados?: number }> {
  const sb = getServerSupabase();
  const folha = await correrFolha(args);

  const jaFechado = folha.linhas.filter((l) => l.status === "final");
  if (jaFechado.length) {
    return {
      ok: false,
      erro: `${jaFechado.length} payslip(s) deste periodo ja estao fechados. `
        + "Reabra-os antes de correr a folha outra vez.",
    };
  }

  const { tabela } = await tabelaDoBanco(Number(folha.payDate.slice(0, 4)));
  const agora = new Date().toISOString();

  const linhas = folha.linhas.map((l) => ({
    client_id: args.clientId, employee_id: l.employeeId,
    year: folha.year, period_no: folha.periodNo, freq_type: folha.freqType,
    pay_date: folha.payDate,
    gross_cents: l.brutoCents, paye_cents: l.payeCents, usc_cents: l.uscCents,
    prsi_ee_cents: l.prsiEeCents, prsi_er_cents: l.prsiErCents, net_cents: l.liquidoCents,
    cum_gross_cents: l.acumulado.bruto, cum_paye_cents: l.acumulado.paye,
    cum_usc_cents: l.acumulado.usc, cum_prsi_cents: l.acumulado.prsi,
    cutoff_used_cents: l.aplicado.cutOff, credits_used_cents: l.aplicado.creditos,
    basis: l.aplicado.base,
    tax_year_used: tabela.ano,
    table_confirmed: !!tabela.confirmadoEm,
    warnings: l.avisos,
    status: "final" as const,
    finalised_at: agora, finalised_by: args.userId ?? null, updated_at: agora,
  }));

  if (!linhas.length) return { ok: false, erro: "Nao ha ninguem para pagar neste periodo." };

  const { error } = await sb.from("hr_payslip")
    .upsert(linhas, { onConflict: "employee_id,year,period_no,freq_type" });
  if (error) return { ok: false, erro: error.message };
  return { ok: true, gravados: linhas.length };
}
