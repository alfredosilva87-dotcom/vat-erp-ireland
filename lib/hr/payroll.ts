/**
 * Os cálculos da folha — portados do Payroll Control do Matheus.
 *
 * Lá esta matemática vivia em `public/app.js`, dentro do navegador, misturada
 * com o desenho da tela. Aqui é um arquivo sem NENHUM import: nada de React,
 * nada de banco, nada de i18n. Duas razões, e a segunda é a que importa.
 *
 * A primeira é que o `npm test` compila este arquivo sozinho e testa cada
 * conta diretamente. No sistema original as mesmas contas só eram exercitadas
 * ATRAVÉS da tela, em jsdom — 337 testes que provam a soma junto com o HTML.
 * Bons testes, mas quando um deles quebra é preciso descobrir se quebrou a
 * conta ou o desenho.
 *
 * A segunda é o motivo de eu não ter "melhorado" nada aqui. Este arquivo é uma
 * tradução, não uma reescrita: os números, a ordem das operações e os casos de
 * borda são os dele, incluindo as decisões que parecem estranhas e não são —
 * a divisão por fazer em `HOLIDAY_DAYS_WEEK`, a média dividida pelas semanas
 * com trabalho e não por cinco, o 4,333. Cada uma dessas custou a alguém uma
 * folha de pagamento errada para ser descoberta. Os comentários que explicam
 * por quê vieram junto, porque são a parte cara.
 */

// ---------------------------------------------------------------- tipos
export type PayType = "Hourly" | "Weekly Fixed" | "Fortnightly Fixed" | "Monthly Fixed";
export type FreqType = "weekly" | "fortnightly" | "monthly";
/** 'na' = por preencher · 'pending' = devido · 'done' = enviado · 'skip' = não se aplica */
export type CellState = "na" | "pending" | "done" | "skip";

export type Employee = {
  id: string;
  pay_type: string;
  hourly_rate?: number | string | null;
  sunday_rate?: number | string | null;
  fixed_amount?: number | string | null;
  contract_type?: string | null;
  holiday_opening?: number | string | null;
  opening_worked?: number | string | null;
};

export type WeekHours = {
  hours?: number | string | null;
  sunday_hours?: number | string | null;
  holiday_hours?: number | string | null;
  week_worked?: boolean | null;
  gross_override?: number | string | null;
};

export type PayrollConfig = {
  freq_type: FreqType;
  issue_day?: string | null;
  week_offset?: number | null;
  tracked_year?: number | null;
  tracked_week?: number | null;
};

export type PayrollClient = {
  freq_weekly?: boolean | null;
  freq_fortnightly?: boolean | null;
  freq_monthly?: boolean | null;
  payroll_config?: PayrollConfig[];
  /** semana → tipo → estados; o formato que a tela do controlo semanal usa */
  weeks?: Record<number, Record<string, WeekCell>>;
};

export type WeekCell = { payslip: CellState; er: CellState; ee: CellState; ros: CellState };

const num = (v: unknown): number =>
  v === null || v === undefined || v === "" ? 0 : Number(v);

// ------------------------------------------------------------- semanas ISO

/** Segunda-feira de uma semana ISO. */
export function isoWeekStart(year: number, week: number): Date {
  const simple = new Date(Date.UTC(year, 0, 4));
  const dow = (simple.getUTCDay() + 6) % 7;
  simple.setUTCDate(simple.getUTCDate() - dow + (week - 1) * 7);
  return simple;
}

/** Qualquer dia de uma semana ISO. `dow`: 1 = segunda … 7 = domingo. */
export function isoWeekDay(year: number, week: number, dow: number): Date {
  const d = isoWeekStart(year, week);
  d.setUTCDate(d.getUTCDate() + (dow - 1));
  return d;
}

/**
 * Semana ISO de uma data já em UTC.
 *
 * Não se reaproveita a versão que lê a data em hora local: as datas dos
 * feriados são construídas em UTC e, num fuso atrás de Greenwich, 1 de janeiro
 * passaria a 31 de dezembro do ano anterior — e o feriado saltava de semana.
 */
export function isoWeekOf(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((t.getTime() - first.getTime()) / (7 * 86400000));
}

/**
 * 52 ou 53 semanas ISO no ano.
 *
 * **Esta é a única função que NÃO é cópia fiel do original — a dele erra.**
 *
 * Lá o teste é "a quinta-feira da semana do dia 31 ainda cai neste ano?", o que
 * responde 53 sempre que 31 de dezembro é quinta, sexta, sábado ou domingo. A
 * regra ISO é outra: o ano tem 53 semanas quando 1 de janeiro é quinta-feira,
 * ou quando é ano bissexto e 1 de janeiro é quarta.
 *
 * A diferença aparece em 2021, 2022, 2023, **2027 e 2028** — anos de 52 semanas
 * que o original conta como 53. Como isto alimenta o seletor de semanas e o
 * número de colunas da grade, nesses anos aparece uma semana 53 que não existe
 * no calendário: dá para navegar até ela, lançar horas nela, e o controlo
 * semanal cobra um payslip por ela.
 *
 * Não mordeu ainda porque 2024, 2025 e 2026 dão o mesmo resultado nas duas
 * contas. 2027 é o primeiro ano em que morde.
 */
export function isoWeeksInYear(y: number): 52 | 53 {
  const jan1 = new Date(Date.UTC(y, 0, 1)).getUTCDay(); // 0 = domingo … 4 = quinta
  const bissexto = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return jan1 === 4 || (bissexto && jan1 === 3) ? 53 : 52;
}

/** A semana ISO de hoje, lida na hora LOCAL (é a semana de quem está a olhar). */
export function currentIsoWeek(when?: Date): number {
  const d = when ? new Date(when) : new Date();
  return isoWeekOf(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}

/** A semana ISO pertence ao mês da sua quinta-feira. */
export const monthOfWeek = (year: number, week: number): number =>
  isoWeekDay(year, week, 4).getUTCMonth();

/** Esta semana contém a última quinta-feira do mês? É quando sai o mensal. */
export function isLastThursdayWeek(year: number, week: number): boolean {
  const th = isoWeekDay(year, week, 4);
  const next = new Date(th);
  next.setUTCDate(th.getUTCDate() + 7);
  return next.getUTCMonth() !== th.getUTCMonth();
}

// ------------------------------------------------------------------ bruto

/**
 * Quantas semanas cabem no período de cada contrato fixo.
 *
 * Vive aqui em cima porque duas coisas dependem dela — o bruto semanal e o
 * bank holiday — e duas cópias da mesma tabela acabam sempre por discordar
 * quando alguém corrige uma e esquece a outra.
 */
export const SEMANAS_POR_PERIODO: Record<string, number> = {
  "Weekly Fixed": 1,
  "Fortnightly Fixed": 2,
  "Monthly Fixed": 4.333,
};

export function grossFor(emp: Employee, h?: WeekHours | null): number {
  // valor lançado à mão manda no cálculo automático
  if (h && h.gross_override !== null && h.gross_override !== undefined)
    return num(h.gross_override);
  const hours = num(h && h.hours);
  const sunday = num(h && h.sunday_hours);
  /*
   * Contrato fixo só é pago na semana marcada como trabalhada — é para isso
   * que serve a caixa 1/0 do Time worked. Sem a marca não há folha: cobre quem
   * ainda não entrou, quem já saiu e a licença sem vencimento.
   *
   * O valor cadastrado é sempre o do período inteiro, e reparte-se pelas
   * semanas dele: uma quinzena são duas semanas, um mês são 4,333. Assim meio
   * período trabalhado paga meio período, sem ninguém fazer a conta à mão — e
   * a soma de um período completo dá exatamente o contrato.
   */
  if (SEMANAS_POR_PERIODO[emp.pay_type]) {
    return h && h.week_worked
      ? num(emp.fixed_amount) / SEMANAS_POR_PERIODO[emp.pay_type]
      : 0;
  }
  return hours * num(emp.hourly_rate) + sunday * num(emp.sunday_rate || emp.hourly_rate);
}

// ------------------------------------------------------------------ férias

export const HOLIDAY_RATE = 0.08; // estatutário irlandês: 8% das horas trabalhadas

/*
 * Pago por hora acumula 8% das horas trabalhadas. Contrato fixo acumula em
 * dias: 20 por ano, repartidos pelas 52 semanas.
 *
 * A divisão fica por fazer de propósito — `20 / 52`, não `0.3846`.
 *
 * O valor exato é 0,384615384615…, uma dízima que não acaba. Escrever `0.3846`
 * à mão parece igual e não é: 52 semanas fechariam o ano em 19,9992 dias em
 * vez de 20. No ecrã as duas versões mostram "20.00", por isso o erro não se
 * veria — mas uma comparação do género "já tem os 20 dias?" responderia que
 * não, e ninguém perceberia porquê.
 *
 * O arredondamento é só na apresentação; o número por trás continua inteiro.
 */
export const HOLIDAY_DAYS_YEAR = 20;
export const HOLIDAY_DAYS_WEEK = HOLIDAY_DAYS_YEAR / 52; // ≈ 0,384615…

export const isHourly = (e: Employee): boolean => e.pay_type === "Hourly";
export const holidayUnit = (e: Employee): "hours" | "days" => (isHourly(e) ? "hours" : "days");

/** Acumulado de férias, na unidade do próprio funcionário. */
export const holidayFor = (e: Employee, hours: number, weeksWorked: number): number =>
  isHourly(e) ? hours * HOLIDAY_RATE : weeksWorked * HOLIDAY_DAYS_WEEK;

/** Saldo disponível = inicial + acumulado − usado. */
export const holidayBalance = (
  e: Employee, accrued: number, used: number
): number => num(e.holiday_opening) + accrued - used;

// ------------------------------------------------- feriados irlandeses

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** N-ésima segunda-feira de um mês (mês 0-based). */
const nthMonday = (year: number, month: number, n: number): Date => {
  const d = new Date(Date.UTC(year, month, 1));
  d.setUTCDate(1 + ((8 - d.getUTCDay()) % 7) + (n - 1) * 7);
  return d;
};

/** Última segunda-feira de um mês. */
const lastMonday = (year: number, month: number): Date => {
  const d = new Date(Date.UTC(year, month + 1, 0)); // último dia do mês
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
};

/** Domingo de Páscoa — computus gregoriano anónimo. */
export const easterSunday = (y: number): Date => {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mes - 1, dia));
};

export type BankHoliday = { key: string; name: string; date: Date; week: number; short: string };

/**
 * Os dez feriados irlandeses do ano — calculados, nunca escritos à mão.
 *
 * Uma lista fixa de datas serve para um ano e caduca em silêncio no seguinte:
 * o ecrã continuaria a mostrar os feriados de 2026 em 2027 sem ninguém dar por
 * isso. As regras é que são estáveis.
 */
export function bankHolidaysOf(year: number): BankHoliday[] {
  // St Brigid: primeira segunda de fevereiro, salvo se 1 de fevereiro for
  // sexta — nesse caso é o próprio dia 1.
  const feb1 = new Date(Date.UTC(year, 1, 1));
  const brigid = feb1.getUTCDay() === 5 ? feb1 : nthMonday(year, 1, 1);
  const pascoa = easterSunday(year);
  const easterMon = new Date(pascoa.getTime() + 86400000);
  const raw: [string, string, Date][] = [
    ["new-year", "New Year's Day", new Date(Date.UTC(year, 0, 1))],
    ["brigid", "St Brigid's Day", brigid],
    ["patrick", "St Patrick's Day", new Date(Date.UTC(year, 2, 17))],
    ["easter", "Easter Monday", easterMon],
    ["may", "May Day", nthMonday(year, 4, 1)],
    ["june", "June holiday", nthMonday(year, 5, 1)],
    ["august", "August holiday", nthMonday(year, 7, 1)],
    ["october", "October holiday", lastMonday(year, 9)],
    ["christmas", "Christmas Day", new Date(Date.UTC(year, 11, 25))],
    ["stephen", "St Stephen's Day", new Date(Date.UTC(year, 11, 26))],
  ];
  return raw.map(([key, name, date]) => ({
    key, name, date,
    week: isoWeekOf(date),
    short: `${date.getUTCDate()} ${MON[date.getUTCMonth()]}`,
  }));
}

export const BH_SEMANAS = 5;
export const BH_MINIMO_HORAS = 40;

export type BankHolidayResult = {
  /** Contrato fixo: direito automático, sem conta a fazer. */
  automatico: boolean;
  fullTime?: boolean;
  elegivel: boolean;
  total: number;
  semanas: number;
  media: number;
  /** Horas a pagar (quem é pago à hora). */
  pagar: number;
  /** Valor em euros a acrescentar ao payslip. */
  pagarEuros: number;
  de: number;
  ate: number;
  janela?: number;
  contrato?: number;
  semanasDoPeriodo?: number;
  porSemana?: number;
};

/**
 * O bank holiday de uma pessoa, na semana do feriado.
 *
 * Quem tem contrato fixo já tem direito, e não há conta a fazer. Quem é pago à
 * hora tem de passar no teste das 40 horas nas 5 semanas anteriores — e é aí
 * que mora o cuidado.
 *
 * **A média divide pelas semanas em que houve trabalho, não por 5.** Quem
 * trabalhou 4 das 5 semanas tem a média das 4. Dividir sempre por 5 puxava a
 * média para baixo e fazia a pessoa receber menos do que devia — o erro cairia
 * sempre para o mesmo lado, que é o pior tipo de erro num cálculo de pagamento.
 *
 * Domingo e férias contam como tempo trabalhado, para o total e para o divisor.
 * Férias contam porque a lei irlandesa manda contar tempo de licença como
 * serviço para este teste; uma semana só de férias não pode fazer a pessoa
 * perder o feriado.
 *
 * O que se paga é **um quinto** da semana normal — daí a média ÷ 5.
 */
export function bankHolidayFor(
  e: Employee,
  semanaRef: number,
  horasDaSemana: (empId: string, week: number) => WeekHours | null | undefined
): BankHolidayResult {
  const primeiraS = Math.max(1, semanaRef - BH_SEMANAS);
  const ultimaS = semanaRef - 1;

  if (!isHourly(e)) {
    /*
     * Mesmo com direito automático conta-se as semanas marcadas como
     * trabalhadas. Não entra em cálculo nenhum — serve para o ecrã responder
     * ao que foi lançado. Sem isso a linha ficava igual quer se preenchesse a
     * grade quer não, e parecia que o separador não estava a atualizar.
     */
    let marcadas = 0;
    for (let w = primeiraS; w <= ultimaS; w++) {
      const h = horasDaSemana(e.id, w);
      if (h && h.week_worked) marcadas++;
    }
    /*
     * Quanto acrescentar ao payslip: um quinto da semana normal, o mesmo
     * critério do pago à hora.
     *
     * O contrato está guardado pelo período inteiro — €1.200 à quinzena,
     * €2.600 ao mês — por isso passa primeiro a semana e só depois se divide
     * por 5. Dividir os €2.600 por 5 dava €520, que não é um dia de trabalho
     * de ninguém.
     */
    const semanasDoPeriodo = SEMANAS_POR_PERIODO[e.pay_type] || 1;
    const porSemana = num(e.fixed_amount) / semanasDoPeriodo;
    return {
      automatico: true, elegivel: true, total: 0, media: 0, pagar: 0,
      semanas: marcadas, janela: ultimaS - primeiraS + 1,
      contrato: num(e.fixed_amount), semanasDoPeriodo, porSemana,
      pagarEuros: porSemana / BH_SEMANAS,
      de: primeiraS, ate: ultimaS,
    };
  }

  // as 5 semanas ANTERIORES à de referência — a própria não entra
  let total = 0, semanas = 0;
  for (let w = primeiraS; w <= ultimaS; w++) {
    const h = horasDaSemana(e.id, w);
    if (!h) continue;
    const naSemana = num(h.hours) + num(h.sunday_hours) + num(h.holiday_hours);
    if (naSemana <= 0) continue; // semana sem nada não entra no divisor
    total += naSemana;
    semanas++;
  }
  const media = semanas ? total / semanas : 0;
  /*
   * O teste das 40 horas é para quem é casual.
   *
   * Full time tem o direito de partida — a lei distingue o trabalhador a tempo
   * inteiro, que não precisa de provar nada, do part-time/casual, que tem de
   * ter 40 horas nas 5 semanas. Continua a calcular-se a média, que é o que
   * diz quantas horas pagar; o que muda é a porta de entrada.
   */
  const fullTime = !/casual/i.test(e.contract_type || "Full time");
  const elegivel = fullTime || total >= BH_MINIMO_HORAS;
  const pagar = elegivel ? media / BH_SEMANAS : 0;
  return {
    automatico: false, fullTime, elegivel, total, semanas, media, pagar,
    // as horas são o que a lei manda; o valor é o que vai no payslip
    pagarEuros: pagar * num(e.hourly_rate),
    de: primeiraS, ate: ultimaS,
  };
}

// -------------------------------------------------- o que vence na semana

/**
 * O que vence — em NÚMEROS, não em texto.
 *
 * O original devolvia frases prontas ("Week 34", "Period 17 · W33+W34"), e num
 * ERP em cinco idiomas isso vaza inglês para dentro de uma tela em português —
 * foi exatamente o que apareceu no primeiro teste de tela. Aqui a função
 * devolve o que sabe e a tela escreve; a tradução é problema de quem desenha,
 * não de quem calcula.
 */
export type Due = {
  type: FreqType;
  /** Dia de emissão, como está guardado ("Monday"…). */
  day: string;
  /** Semanal: a semana PRÓPRIA da empresa, já descontado o atraso dela. */
  ownWeek?: number;
  /** Quinzenal: o número do período e as duas semanas que ele cobre. */
  period?: number;
  periodWeeks?: [number, number];
  /** Mensal: o mês, 0-based. */
  month?: number;
};

/**
 * O que esta empresa tem de enviar na semana de calendário pedida.
 *
 * As datas já são conhecidas: o semanal sai toda semana no dia dela, o
 * quinzenal na quinta seguinte ao fecho do período, e o mensal na última
 * quinta do mês. Cada empresa pode andar atrás do calendário.
 *
 * `hoje` entra por parâmetro em vez de se ler o relógio aqui dentro: é o que
 * torna esta função testável sem congelar o tempo, e o que impede o resultado
 * de mudar sozinho à meia-noite no meio de uma tela aberta.
 */
export function dueInWeek(
  client: PayrollClient, year: number, calWeek: number, hoje?: { year: number; week: number }
): Due[] {
  const out: Due[] = [];
  const agora = hoje ?? { year: new Date().getFullYear(), week: currentIsoWeek() };
  const cfgOf = (t: FreqType): Partial<PayrollConfig> =>
    (client.payroll_config || []).find((x) => x.freq_type === t) || {};

  /**
   * A empresa roda este tipo de payslip?
   *
   * Uma fonte só: as caixas do cadastro. Chegou a haver uma segunda — bastar
   * ter um funcionário no bloco — mas duas fontes para a mesma verdade acabam
   * sempre por discordar.
   */
  const runs = (t: FreqType): boolean => {
    const k = ("freq_" + t) as keyof PayrollClient;
    return !!client[k];
  };

  /**
   * A partir de que semana este tipo conta.
   *
   * Sem isto, marcar hoje uma empresa como mensal fazia aparecerem doze meses
   * de dívida que nunca existiu. O controlo começa quando o tipo entra no
   * sistema, não quando o funcionário entrou na empresa.
   */
  const startsAt = (t: FreqType): number => {
    const g = cfgOf(t);
    // Sem bloco de configuração, o tipo nasceu agora — de um funcionário
    // acabado de cadastrar. Começa a contar nesta semana, e não no início do
    // ano: os payslips que não passaram pelo sistema não são dívida.
    if (g.tracked_week == null) return year === agora.year ? agora.week : 1;
    const ty = Number(g.tracked_year || year);
    if (ty < year) return 1;              // veio de um ano anterior: conta todo
    if (ty > year) return Infinity;       // ainda não começou neste ano
    return Number(g.tracked_week);
  };
  const tracked = (t: FreqType): boolean => calWeek >= startsAt(t);

  // o semanal sai todas as semanas, no dia da empresa
  if (runs("weekly") && tracked("weekly")) {
    const g = cfgOf("weekly");
    const own = calWeek - Number(g.week_offset || 0);
    if (own >= 1) {
      out.push({ type: "weekly", day: g.issue_day || "Thursday", ownWeek: own });
    }
  }
  // o quinzenal só na semana seguinte ao fecho do período:
  // o período 1 cobre as semanas 1 e 2 e sai na semana 3
  if (runs("fortnightly") && tracked("fortnightly")) {
    const g = cfgOf("fortnightly");
    const own = calWeek - Number(g.week_offset || 0);
    if (own >= 3 && own % 2 === 1) {
      const p = (own - 1) / 2;
      out.push({
        type: "fortnightly", day: "Thursday",
        period: p, periodWeeks: [2 * p - 1, 2 * p],
      });
    }
  }
  // o mensal só na semana da última quinta-feira do mês
  if (runs("monthly") && tracked("monthly") && isLastThursdayWeek(year, calWeek)) {
    const m = monthOfWeek(year, calWeek);
    out.push({ type: "monthly", day: "Thursday", month: m });
  }
  return out;
}

// ------------------------------------------------------ estado da semana

export const DFIELDS: (keyof WeekCell)[] = ["payslip", "er", "ee", "ros"];
export const BLANK_WEEK: WeekCell = { payslip: "na", er: "na", ee: "na", ros: "na" };

/**
 * Uma célula está resolvida?
 *
 * 'done' e 'skip' fecham; 'na' e 'pending' não. É a única regra que separa a
 * fila de trabalho do ruído: 'na' é resposta que falta, 'skip' é uma decisão.
 */
export const SETTLED = (v: CellState | string): boolean => v === "done" || v === "skip";

export const cellOf = (client: PayrollClient, week: number, type: string): WeekCell =>
  (client.weeks && client.weeks[week] && client.weeks[week][type]) || BLANK_WEEK;

export const typeSettled = (client: PayrollClient, week: number, type: string): boolean =>
  DFIELDS.every((k) => SETTLED(cellOf(client, week, type)[k]));

/** Só falta a submissão à Revenue: é a fila que se despacha em minutos. */
export const typeOnlyRos = (client: PayrollClient, week: number, type: string): boolean => {
  const x = cellOf(client, week, type);
  return !SETTLED(x.ros) && (["payslip", "er", "ee"] as (keyof WeekCell)[]).every((k) => SETTLED(x[k]));
};

export type Backlog = { week: number; type: FreqType; open: (keyof WeekCell)[] };

/**
 * Semanas passadas que a empresa deixou por fechar.
 *
 * O traço muda de significado consoante o lado do calendário em que está. Numa
 * semana que ainda não chegou, '–' quer dizer "por preencher" e não é dívida
 * nenhuma. Numa semana que já passou, ninguém vai lá preencher: o prazo foi-se,
 * e o que ficou em branco é exatamente tão devido como um '✕'.
 */
export function backlogWeeks(
  client: PayrollClient, year: number, upToWeek: number, hoje?: { year: number; week: number }
): Backlog[] {
  const out: Backlog[] = [];
  for (let w = 1; w < upToWeek; w++) {
    for (const d of dueInWeek(client, year, w, hoje)) {
      const open = DFIELDS.filter((k) => !SETTLED(cellOf(client, w, d.type)[k]));
      if (open.length) out.push({ week: w, type: d.type, open });
    }
  }
  return out;
}
