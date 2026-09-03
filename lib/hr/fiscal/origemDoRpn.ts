/**
 * DE ONDE VÊM OS NÚMEROS DO RPN — e quem ganha quando há mais do que um.
 *
 * ---------------------------------------------------------------------------
 * HÁ TRÊS FONTES, E ELAS NÃO VALEM O MESMO
 *
 * 1. **A Revenue**, pelo serviço de RPN. É a verdade: foi ela que repartiu os
 *    créditos e o cut-off entre os empregos desta pessoa, e só ela sabe o que
 *    o outro empregador está a usar.
 * 2. **O que alguém escreveu no cadastro** (`rpn_cutoff_cents`,
 *    `rpn_credits_cents`). Normalmente copiado à mão de um RPN em papel ou do
 *    ecrã do ROS. Serve, e serviu até hoje — mas envelhece em silêncio.
 * 3. **O palpite a partir da situação familiar**, com as tabelas do ano. É o
 *    que o motor faz quando não tem mais nada, e está certo para quem tem UM
 *    emprego e nada de especial.
 *
 * A ordem é essa, e não é negociável: um número que a Revenue mandou não pode
 * perder para um número que alguém copiou à mão há três meses.
 *
 * ---------------------------------------------------------------------------
 * A BASE DE TRIBUTAÇÃO TAMBÉM VEM DAQUI, E ISSO É O MAIS IMPORTANTE
 *
 * Hoje a base sai de um `<select>` do cadastro. Isso põe uma decisão da
 * Revenue nas mãos de quem preenche o formulário — e a varredura encontrou
 * exactamente o estrago que isso permite: dá para gravar alguém em base
 * **cumulativa sem RPN nenhum**, que é o oposto do que a regra irlandesa
 * manda. Em cumulativa sem RPN desconta-se a menos, e a diferença reaparece
 * como dívida do trabalhador meses depois.
 *
 * Com RPN, a base é a que ele diz. Sem RPN, é **emergência** — que é o que a
 * lei manda e, não por acaso, também o lado seguro do erro: desconta a mais e
 * devolve-se, em vez de descontar a menos e cobrar-se.
 */

/** O que a Revenue mandou, já em cêntimos. Ver lib/revenue/rpn.ts. */
export interface RpnDaRevenue {
  calculation_basis?: string | null;
  yearly_tax_credits?: number | string | null;
  yearly_cut_off?: number | string | null;
  pay_tax_to_date?: number | string | null;
  tax_deducted_to_date?: number | string | null;
  pay_usc_to_date?: number | string | null;
  usc_deducted_to_date?: number | string | null;
  lpt_to_deduct?: number | string | null;
  rpn_number?: string | null;
}

/** O que o cadastro tem — copiado à mão, ou vazio. */
export interface RpnDoCadastro {
  rpn_cutoff_cents?: number | string | null;
  rpn_credits_cents?: number | string | null;
  rpn_number?: string | null;
  tax_basis?: string | null;
}

export type Base = "cumulativa" | "semana1" | "emergencia";

export interface Escolha {
  /** `revenue` | `cadastro` | `nenhum` — para o recibo poder dizê-lo. */
  origem: "revenue" | "cadastro" | "nenhum";
  base: Base;
  cutOffAnual?: number;
  creditosAnuais?: number;
  /** Acumulado do ano NOUTRO emprego ou antes de nós. Ver abaixo. */
  acumuladoDaRevenue?: { bruto: number; paye: number; usc: number } | null;
  lptADescontar?: number | null;
  rpnNumero?: string | null;
  /** O que dizer a quem lê o recibo. Chaves, não frases. */
  avisos: string[];
}

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Traduz a base como a Revenue a escreve para a que o motor entende.
 *
 * Desconhecido cai em emergência de propósito — inventar "cumulativa" a partir
 * de uma palavra que não se reconhece seria escolher o lado errado do erro.
 */
export function baseDaRevenue(s: string | null | undefined): Base | null {
  const v = String(s ?? "").trim().toUpperCase();
  if (!v) return null;
  if (v === "CUMULATIVE") return "cumulativa";
  if (v === "WEEK1" || v === "MONTH1" || v === "WEEK1/MONTH1") return "semana1";
  if (v === "EMERGENCY") return "emergencia";
  return "emergencia";
}

/**
 * Decide, com a ordem de precedência acima.
 *
 * `haRpnDaRevenue` é separado de `rpn` porque a Revenue devolve o empregado na
 * lista mesmo quando NÃO tem RPN para ele — e "veio na lista sem RPN" é uma
 * coisa muito diferente de "nunca perguntámos". A primeira quer dizer que é
 * preciso pedir um RPN novo.
 */
export function escolherRpn(
  daRevenue: RpnDaRevenue | null | undefined,
  doCadastro: RpnDoCadastro | null | undefined,
  /*
   * A REGRA SÓ APERTA QUANDO HÁ LIGAÇÃO À REVENUE.
   *
   * Forçar emergência sem RPN é o que a lei manda — mas enquanto não houver
   * certificado instalado, NINGUÉM pode ter RPN, e a regra passaria toda a
   * carteira para emergência de um dia para o outro sem que houvesse forma de
   * sair dessa situação. Isso não é rigor, é uma armadilha.
   *
   * Com certificado instalado, o RPN passa a ser obtenível, e a exigência
   * torna-se justa: quem não o foi buscar corre em emergência, como deve.
   *
   * O aviso `aviso.semRpn` aparece nos DOIS casos — a falta é dita desde o
   * primeiro dia, mesmo quando ainda não trava nada.
   */
  exigirRpn = false
): Escolha {
  const avisos: string[] = [];

  // ---- 1. A Revenue, quando falou.
  if (daRevenue && daRevenue.rpn_number) {
    const base = baseDaRevenue(daRevenue.calculation_basis) ?? "emergencia";
    const bruto = num(daRevenue.pay_tax_to_date);
    const paye = num(daRevenue.tax_deducted_to_date);
    const usc = num(daRevenue.usc_deducted_to_date);
    return {
      origem: "revenue",
      base,
      cutOffAnual: num(daRevenue.yearly_cut_off),
      creditosAnuais: num(daRevenue.yearly_tax_credits),
      /*
       * O ACUMULADO QUE VEM DA REVENUE, e porque ele importa tanto.
       *
       * Quem entra a meio do ano já pagou imposto noutro emprego. O nosso
       * acumulado só conhece os recibos que NÓS emitimos, portanto começa a
       * zero — e num cálculo cumulativo isso dá a essa pessoa a fatia da taxa
       * normal outra vez, do princípio. Desconta-se a menos, e a Revenue cobra
       * a diferença ao trabalhador no fim do ano.
       *
       * `payForIncomeTaxToDate` e `incomeTaxDeductedToDate` são exactamente o
       * que fecha esse buraco.
       */
      acumuladoDaRevenue:
        bruto !== undefined || paye !== undefined || usc !== undefined
          ? { bruto: bruto ?? 0, paye: paye ?? 0, usc: usc ?? 0 }
          : null,
      lptADescontar: num(daRevenue.lpt_to_deduct) ?? null,
      rpnNumero: daRevenue.rpn_number,
      avisos,
    };
  }

  // ---- 2. O que alguém copiou para o cadastro.
  const cutCadastro = num(doCadastro?.rpn_cutoff_cents);
  const credCadastro = num(doCadastro?.rpn_credits_cents);
  if (cutCadastro !== undefined || credCadastro !== undefined) {
    avisos.push("aviso.rpnDoCadastro");
    const base = (doCadastro?.tax_basis as Base) || "cumulativa";
    return {
      origem: "cadastro",
      base,
      cutOffAnual: cutCadastro,
      creditosAnuais: credCadastro,
      acumuladoDaRevenue: null,
      lptADescontar: null,
      rpnNumero: doCadastro?.rpn_number ?? null,
      avisos,
    };
  }

  /*
   * ---- 3. Nada. E aqui está a correcção que mais vale.
   *
   * O cadastro podia dizer "cumulativa" — e dizia, por omissão. Sem RPN, a
   * regra irlandesa manda EMERGÊNCIA, e este é também o lado seguro: desconta
   * a mais e devolve-se, em vez de descontar a menos e ser cobrado depois.
   */
  avisos.push("aviso.semRpn");
  const pedida = (doCadastro?.tax_basis as Base | undefined) || "cumulativa";
  const base: Base = exigirRpn ? "emergencia" : pedida;
  if (exigirRpn && pedida !== "emergencia") avisos.push("aviso.baseForcadaEmergencia");
  return {
    origem: "nenhum",
    base,
    acumuladoDaRevenue: null,
    lptADescontar: null,
    rpnNumero: null,
    avisos,
  };
}
