import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { tabelaDoBanco } from "@/lib/hr/fiscal/tabelasDb";
import { calcular, type Aviso, type Base, type Situacao } from "@/lib/hr/fiscal/motor";
import { escolherRpn } from "@/lib/hr/fiscal/origemDoRpn";
import { grossDetail, grossFor, isoWeekStart, type Employee, type WeekHours } from "@/lib/hr/payroll";
import type { ConfigDaEmpresa } from "@/lib/hr/regrasDaEmpresa";

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
  /** De onde vem o bruto, semana a semana — ver a nota em `correrFolha`. */
  memoria: {
    semana: number;
    totalCents: number;
    parcelas: { chave: string; horas: number; taxaCents: number; valorCents: number }[];
    avisos: string[];
    origemDomingo: string;
  }[];
  payeCents: number;
  uscCents: number;
  prsiEeCents: number;
  prsiErCents: number;
  liquidoCents: number;
  custoEmpregadorCents: number;
  aeEeCents: number;
  aeErCents: number;
  acumulado: { bruto: number; paye: number; usc: number; prsi: number };
  aplicado: { cutOff: number; creditos: number; base: Base };
  avisos: Aviso[];
  /** Devolução apurada e segura para o período seguinte. Zero quando não há. */
  devolucaoSeguraCents: number;
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
    aeEe: number; aeEr: number; liquido: number; custoEmpregador: number;
  };
  /** O que impede esta folha de ser tomada por definitiva. */
  avisos: Aviso[];
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

  const [{ data: emps }, { data: horas }, { data: fechados }, { data: seguros },
         { data: rpnsDaRevenue }, { count: temLigacao }] = await Promise.all([
    sb.from("hr_employees").select("*")
      .eq("client_id", args.clientId).eq("freq_type", freqType).eq("active", true)
      .order("first_name"),
    sb.from("hr_employee_hours").select("*").eq("year", year),
    sb.from("hr_payslip").select("*")
      .eq("client_id", args.clientId).eq("year", year).eq("freq_type", freqType),
    // As devolucoes que alguem decidiu segurar NESTE periodo.
    sb.from("hr_refund_hold").select("employee_id,reason")
      .eq("client_id", args.clientId).eq("year", year)
      .eq("period_no", periodNo).eq("freq_type", freqType),
    /*
     * O QUE A REVENUE MANDOU, por emprego. Ver lib/hr/fiscal/origemDoRpn.ts.
     *
     * Enquanto não houver certificado instalado esta lista vem vazia, e tudo
     * funciona como sempre funcionou — com o aviso `aviso.semRpn`, que já
     * existia. A partir do momento em que há ligação, o RPN passa a mandar.
     */
    sb.from("revenue_rpn").select("*").eq("client_id", args.clientId).eq("tax_year", year),
    // Há ligação instalada? É isto que decide se a regra do RPN APERTA.
    sb.from("revenue_credentials").select("id", { count: "exact", head: true }),
  ]);

  /*
   * AS REGRAS DE PAGAMENTO DA EMPRESA — e isto faltava aqui.
   *
   * O bruto era calculado com `grossFor(e, h)` **sem configuração nenhuma**.
   * Ou seja: o multiplicador de domingo podia estar gravado no cadastro, o ecrã
   * das regras mostrá-lo, o exemplo bater certo — e a folha continuar a pagar o
   * domingo à taxa normal, porque quem calcula a sério nunca lia a regra.
   *
   * Um erro assim é dos piores que há: tudo à volta diz que está a funcionar.
   */
  const { data: regrasDaEmpresa } = await sb.from("hr_client")
    .select("sunday_mode,sunday_multiplier,overtime_after_hours,overtime_multiplier,"
      + "holiday_accrual_pct,holiday_days_year")
    .eq("client_id", args.clientId).maybeSingle();
  const cfgEmpresa = (regrasDaEmpresa ?? null) as ConfigDaEmpresa | null;

  const funcionarios = ((emps ?? []) as any[]);
  const porFuncionario = new Map<string, any[]>();
  for (const h of ((horas ?? []) as any[])) {
    const a = porFuncionario.get(h.employee_id) ?? [];
    a.push(h); porFuncionario.set(h.employee_id, a);
  }
  const payslips = ((fechados ?? []) as any[]);
  const segurados = new Set(((seguros ?? []) as any[]).map((r) => r.employee_id));

  /*
   * Os RPN indexados por PPS + `employmentID`.
   *
   * A chave TEM de levar o emprego: uma pessoa com dois empregos tem dois RPN,
   * com créditos repartidos entre eles. Indexar só por PPS faria um sobrescrever
   * o outro, e o desconto sairia errado nos dois.
   */
  const rpnPorEmprego = new Map<string, any>();
  for (const r of ((rpnsDaRevenue ?? []) as any[])) {
    rpnPorEmprego.set(`${r.employee_ppsn}|${r.employment_id}`, r);
  }
  const exigirRpn = (temLigacao ?? 0) > 0;

  const avisos: Aviso[] = [];
  if (deFabrica) {
    avisos.push({ codigo: "aviso.tabelaDeFabrica", params: { ano: payDate.slice(0, 4) } });
  }

  const linhas: LinhaDaFolha[] = funcionarios.map((e) => {
    // ---- 1. o BRUTO, pelas funções que já existiam
    const doPeriodo = (porFuncionario.get(e.id) ?? []).filter((h) => semanas.includes(h.week_no));
    const brutoCents = doPeriodo.reduce(
      (s, h) => s + Math.round(grossFor(e as Employee, h as WeekHours, cfgEmpresa) * 100), 0
    );

    /*
     * A MEMÓRIA DE CÁLCULO do bruto, semana a semana.
     *
     * Vai junto com a linha porque é a resposta à única pergunta que se faz a
     * olhar para um recibo: *de onde vem este número?*. Um total sozinho não se
     * confere — com "32h × 13,00 + 8h × 26,00" ao lado, uma taxa errada salta à
     * vista em vez de sair no salário.
     *
     * Calcula-se aqui e não no ecrã: repetir a multiplicação no navegador daria
     * um detalhe que concorda com a tela e discorda do recibo.
     */
    const memoria = doPeriodo
      .sort((a, b) => a.week_no - b.week_no)
      .map((h) => {
        const d = grossDetail(e as Employee, h as WeekHours, cfgEmpresa);
        return {
          semana: h.week_no,
          totalCents: Math.round(d.total * 100),
          parcelas: d.parcelas.map((pa) => ({
            chave: pa.chave, horas: pa.horas,
            taxaCents: Math.round(pa.taxa * 100), valorCents: Math.round(pa.valor * 100),
          })),
          avisos: d.avisos,
          origemDomingo: d.regras.origemDomingo,
        };
      });

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

    /*
     * ---- 2b. QUEM MANDA NOS NÚMEROS FISCAIS
     *
     * Revenue > cadastro > palpite. E a BASE vem daí também — deixá-la sair de
     * um `<select>` do cadastro punha uma decisão da Revenue nas mãos de quem
     * preenche o formulário.
     */
    const escolha = escolherRpn(
      rpnPorEmprego.get(`${e.pps_number ?? ""}|${e.employment_id ?? "1"}`) ?? null,
      e,
      exigirRpn
    );

    /*
     * O acumulado da Revenue SOMA-SE ao nosso, não o substitui.
     *
     * O deles é o que a pessoa levou de OUTRO emprego (ou de antes de nós); o
     * nosso é o que já lhe pagámos este ano. Trocar um pelo outro perderia
     * metade do ano em qualquer dos sentidos.
     */
    const daRevenue = escolha.acumuladoDaRevenue;
    const acumuladoFinal = daRevenue
      ? {
          bruto: acumuladoAnterior.bruto + daRevenue.bruto,
          paye: acumuladoAnterior.paye + daRevenue.paye,
          usc: acumuladoAnterior.usc + daRevenue.usc,
          prsiEmpregado: acumuladoAnterior.prsiEmpregado,
        }
      : acumuladoAnterior;

    // ---- 3. o IMPOSTO
    const r = calcular({
      brutoPeriodo: brutoCents,
      dataPagamento: payDate,
      periodosNoAno: PERIODOS[freqType],
      periodoNo: periodNo,
      base: escolha.base as Base,
      situacao: (e.marital_status || "solteiro") as Situacao,
      rpn: escolha.cutOffAnual !== undefined || escolha.creditosAnuais !== undefined
        ? { cutOffAnual: escolha.cutOffAnual, creditosAnuais: escolha.creditosAnuais }
        : null,
      acumuladoAnterior: acumuladoFinal,
      uscReduzido: !!e.usc_reduced,
      isentoUSC: !!e.usc_exempt,
      classePRSI: e.prsi_class,
      segurarDevolucao: segurados.has(e.id),
      // `null` no banco quer dizer "por avaliar": ai o motor aplica o teste da
      // lei. `undefined` e o que ele espera para esse caso.
      aeInscrito: e.ae_enrolled === null || e.ae_enrolled === undefined
        ? undefined : !!e.ae_enrolled,
      dataNascimento: e.date_of_birth ?? null,
      temPensaoOcupacional: !!e.has_occupational_pension,
    }, tabela);

    const jaGravado = payslips.find((p) => p.employee_id === e.id && p.period_no === periodNo);

    const proprios = [...r.avisos];
    // De onde vieram os números fiscais é informação do RECIBO, não um detalhe
    // interno: é o que responde a "porque é que o desconto mudou?".
    for (const c of escolha.avisos) {
      if (!proprios.some((a) => a.codigo === c)) proprios.push({ codigo: c } as Aviso);
    }
    if (!e.pps_number) proprios.push({ codigo: "aviso.semPps" });

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
        proprios.push({
          codigo: "aviso.buracoAcumulado",
          params: {
            n: buracos.length,
            quais: buracos.slice(0, 6).join(", ") + (buracos.length > 6 ? "…" : ""),
          },
        });
      }
    }

    return {
      employeeId: e.id,
      nome: [e.first_name, e.surname].filter(Boolean).join(" "),
      jobTitle: e.job_title ?? null,
      freqType,
      brutoCents,
      memoria,
      payeCents: r.paye,
      uscCents: r.usc,
      prsiEeCents: r.prsiEmpregado,
      prsiErCents: r.prsiEmpregador,
      liquidoCents: r.liquido,
      custoEmpregadorCents: r.custoEmpregador,
      aeEeCents: r.aeEmpregado,
      aeErCents: r.aeEmpregador,
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
      devolucaoSeguraCents: r.devolucaoSegura,
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
      aeEe: soma((l) => l.aeEeCents),
      aeEr: soma((l) => l.aeErCents),
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
  /*
   * A FOLHA CALCULADA volta junto com o resultado.
   *
   * Quem fecha precisa dos totais logo a seguir, para criar os títulos a pagar
   * (ver `garantirTitulosDaFolha`). Correr `correrFolha` outra vez na rota daria
   * um segundo cálculo — e um segundo cálculo pode divergir do primeiro, porque
   * o acumulado que ele lê já inclui os payslips que acabaram de ser gravados.
   * O título ficaria com um número que o recibo não confirma.
   */
}): Promise<{ ok: boolean; erro?: string; gravados?: number; folha?: Folha }> {
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
    ae_ee_cents: l.aeEeCents, ae_er_cents: l.aeErCents,
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
  return { ok: true, gravados: linhas.length, folha };
}
