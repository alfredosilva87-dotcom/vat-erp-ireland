/**
 * AS REGRAS QUE MUDAM DE EMPRESA PARA EMPRESA.
 *
 * ---------------------------------------------------------------------------
 * PORQUE ISTO PRECISOU DE EXISTIR
 *
 * O bruto da semana era esta linha, e mais nada:
 *
 *     horas × taxa_hora  +  horas_domingo × (taxa_domingo || taxa_hora)
 *
 * Duas coisas estavam mal aí.
 *
 * A primeira: o prémio de domingo vivia num campo **por funcionário**, escrito
 * à mão em cada ficha. Quem deixasse esse campo em branco pagava o domingo ao
 * preço de um dia normal — em silêncio, sem aviso nenhum. A lei irlandesa dá
 * direito a compensação por trabalho ao domingo; o produto permitia não a pagar
 * e não dizia nada.
 *
 * A segunda: férias eram 8% e 20 dias cravados no código, para toda a gente. Há
 * empresas que dão mais do que o mínimo legal, e essas não cabiam no sistema.
 *
 * ---------------------------------------------------------------------------
 * A ORDEM DE PRECEDÊNCIA, E PORQUE ELA É ESTA
 *
 *   campo do FUNCIONÁRIO  >  regra da EMPRESA  >  mínimo da LEI
 *
 * O funcionário ganha porque existe sempre o contrato individual diferente do
 * resto da casa, e apagar essa possibilidade para simplificar trocaria um
 * problema por outro. A empresa ganha à lei porque a lei é um MÍNIMO — dar mais
 * é legal, dar menos não.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE MÓDULO NÃO FAZ
 *
 * Não decide se houve horas extras a partir do contrato, nem lê turnos. Recebe
 * as horas que alguém lançou e aplica as regras. Adivinhar mais do que isso
 * seria inventar factos sobre o trabalho de alguém.
 */

/** O mínimo legal irlandês. É o que vale quando ninguém configurou nada. */
export const LEI = {
  /** Percentagem das horas trabalhadas que acumula férias. */
  feriasPct: 8,
  /** Dias de férias por ano, para contrato fixo. */
  feriasDias: 20,
};

/** A configuração como está gravada em `hr_client_config`. */
export interface ConfigDaEmpresa {
  sunday_mode?: string | null;
  sunday_multiplier?: number | string | null;
  overtime_after_hours?: number | string | null;
  overtime_multiplier?: number | string | null;
  holiday_accrual_pct?: number | string | null;
  holiday_days_year?: number | string | null;
}

/** O que o funcionário traz de próprio. */
export interface DadosDoFuncionario {
  hourly_rate?: number | string | null;
  /** Quando preenchido, GANHA à regra da empresa. */
  sunday_rate?: number | string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface RegrasEfectivas {
  taxaHora: number;
  /** O que se paga por hora ao domingo, já decidido. */
  taxaDomingo: number;
  /** De onde veio a taxa de domingo — para o ecrã poder explicá-la. */
  origemDomingo: "funcionario" | "empresa" | "semPremio";
  /** A partir de quantas horas conta como extra. Nulo = a empresa não tem regra. */
  extrasAPartirDe: number | null;
  taxaExtra: number | null;
  feriasPct: number;
  feriasDias: number;
  /** O que o ecrã tem de dizer em voz alta. Chaves, não frases. */
  avisos: string[];
}

/**
 * Resolve as regras para UM funcionário desta empresa.
 *
 * Devolve números já decididos, e não a configuração: quem calcula não tem de
 * saber de onde veio cada coisa. Mas devolve TAMBÉM a origem, porque quem olha
 * para o recibo tem.
 */
export function regrasPara(
  cfg: ConfigDaEmpresa | null | undefined,
  emp: DadosDoFuncionario
): RegrasEfectivas {
  const avisos: string[] = [];
  const taxaHora = num(emp.hourly_rate) ?? 0;

  // ---- Domingo -------------------------------------------------------------
  const doFuncionario = num(emp.sunday_rate);
  const modo = String(cfg?.sunday_mode ?? "rate");
  const multiplicador = num(cfg?.sunday_multiplier);

  let taxaDomingo: number;
  let origemDomingo: RegrasEfectivas["origemDomingo"];

  if (doFuncionario !== null && doFuncionario > 0) {
    taxaDomingo = doFuncionario;
    origemDomingo = "funcionario";
  } else if (modo === "multiplier" && multiplicador !== null && multiplicador > 0) {
    taxaDomingo = taxaHora * multiplicador;
    origemDomingo = "empresa";
  } else {
    /*
     * NEM UMA COISA NEM OUTRA — e isto passa a ser dito.
     *
     * Antes, este caso caía calado na taxa normal. O domingo era pago como uma
     * terça-feira e ninguém ficava a saber. Continua a cair na taxa normal
     * (mudar o número sem ninguém pedir seria pior), mas agora grita.
     */
    taxaDomingo = taxaHora;
    origemDomingo = "semPremio";
    avisos.push("regra.semPremioDomingo");
  }

  // ---- Horas extras --------------------------------------------------------
  const extrasAPartirDe = num(cfg?.overtime_after_hours);
  const multExtra = num(cfg?.overtime_multiplier);
  /*
   * Meia regra não é regra.
   *
   * "A partir de 39 horas" sem multiplicador, ou um multiplicador sem limiar,
   * não dizem o que fazer — e aplicar metade produziria um número plausível e
   * errado. Fica por configurar, e diz-se.
   */
  const temExtras = extrasAPartirDe !== null && extrasAPartirDe > 0 && multExtra !== null && multExtra > 0;
  if ((extrasAPartirDe !== null) !== (multExtra !== null)) avisos.push("regra.extrasIncompleta");

  return {
    taxaHora,
    taxaDomingo,
    origemDomingo,
    extrasAPartirDe: temExtras ? extrasAPartirDe : null,
    taxaExtra: temExtras ? taxaHora * (multExtra as number) : null,
    feriasPct: num(cfg?.holiday_accrual_pct) ?? LEI.feriasPct,
    feriasDias: num(cfg?.holiday_days_year) ?? LEI.feriasDias,
    avisos,
  };
}

/** Uma parcela do bruto, com a conta à vista. */
export interface Parcela {
  /** Chave de tradução: `parcela.normais`, `parcela.extras`, `parcela.domingo`. */
  chave: string;
  horas: number;
  taxa: number;
  valor: number;
}

export interface BrutoDaSemana {
  total: number;
  parcelas: Parcela[];
  avisos: string[];
}

/**
 * O BRUTO DE UMA SEMANA, COM A MEMÓRIA DE CÁLCULO.
 *
 * Devolve as parcelas e não só a soma, e essa é a diferença que interessa: um
 * número sozinho não se confere. Com as parcelas, quem olha vê
 * "32h × 13,00 + 6h × 19,50" e percebe imediatamente se está certo — e vê o
 * prémio de domingo que antes desaparecia dentro de um total.
 *
 * `horasDomingo` são horas SEPARADAS das normais, e somam-se a elas: é assim
 * que o quadro do produto as apresenta desde sempre, e mudar isso agora
 * mudaria o bruto de toda a gente sem ninguém pedir.
 */
export function brutoDaSemana(
  regras: RegrasEfectivas,
  horas: { normais: number; domingo: number }
): BrutoDaSemana {
  const parcelas: Parcela[] = [];
  const normais = Math.max(0, horas.normais || 0);
  const domingo = Math.max(0, horas.domingo || 0);

  /*
   * As extras contam-se sobre as horas NORMAIS, não sobre o total.
   *
   * O domingo já é pago a prémio; fazê-lo contar também para o limiar das
   * extras pagaria duas vezes o mesmo excesso. Quando uma empresa quiser as
   * duas coisas, isso é uma regra nova e explícita — não um efeito lateral.
   */
  if (regras.extrasAPartirDe !== null && normais > regras.extrasAPartirDe) {
    const base = regras.extrasAPartirDe;
    const extra = normais - base;
    if (base > 0) parcelas.push({ chave: "parcela.normais", horas: base, taxa: regras.taxaHora, valor: base * regras.taxaHora });
    parcelas.push({ chave: "parcela.extras", horas: extra, taxa: regras.taxaExtra as number, valor: extra * (regras.taxaExtra as number) });
  } else if (normais > 0) {
    parcelas.push({ chave: "parcela.normais", horas: normais, taxa: regras.taxaHora, valor: normais * regras.taxaHora });
  }

  if (domingo > 0) {
    parcelas.push({ chave: "parcela.domingo", horas: domingo, taxa: regras.taxaDomingo, valor: domingo * regras.taxaDomingo });
  }

  const total = parcelas.reduce((s, p) => s + p.valor, 0);
  // Só se avisa da falta de prémio quando houve mesmo domingo trabalhado. Um
  // aviso que aparece em toda a gente deixa de ser lido.
  const avisos = domingo > 0 ? regras.avisos : regras.avisos.filter((a) => a !== "regra.semPremioDomingo");

  return { total: Math.round(total * 100) / 100, parcelas, avisos };
}

/**
 * Férias acumuladas na semana, para quem é pago à hora.
 *
 * A percentagem vem da empresa; 8% é o mínimo legal e o que vale quando
 * ninguém mexeu. As horas de domingo contam — são horas trabalhadas.
 */
export function feriasDaSemana(regras: RegrasEfectivas, horasTrabalhadas: number): number {
  return Math.max(0, horasTrabalhadas || 0) * (regras.feriasPct / 100);
}
