/**
 * O RPN DE ENSAIO: números plausíveis que nunca se conseguem confundir com os
 * verdadeiros.
 *
 * ---------------------------------------------------------------------------
 * PLAUSÍVEL O SUFICIENTE PARA DEMONSTRAR, FALSO O SUFICIENTE PARA SE VER
 *
 * Os valores são os do caso normal irlandês — €4.000 de créditos anuais e
 * €44.000 de cut-off, que é o solteiro sem nada de especial — porque uma
 * demonstração com números absurdos não demonstra nada: ninguém consegue
 * conferir se o desconto que saiu está certo.
 *
 * Ao mesmo tempo, tudo o que identifica a linha grita ensaio: o número do RPN
 * começa por `SIM-` e sai assim IMPRESSO no recibo, e o `raw` — que é onde
 * alguém vai procurar quando perguntar "de onde veio este número?" — diz-lo por
 * extenso, com quem pediu e quando.
 *
 * O acumulado é opcional e vem em valores redondos de propósito: €8.000 de
 * bruto, €600 de PAYE, €150 de USC. Um acumulado com cêntimos parece extraído
 * de um sistema; um acumulado redondo parece o que é.
 *
 * ---------------------------------------------------------------------------
 * PURO, E SEM ACESSO A NADA
 *
 * Este módulo não fala com o banco e não decide se pode ou não semear — isso é
 * da rota, e está lá explicado. Aqui só se monta a linha. A separação existe
 * para a trava (`ehClienteDeDemonstracao`) poder ser lida e testada sem servidor
 * nenhum: é a peça de que depende não haver dado falso num cliente real.
 */

/** Créditos anuais do caso normal, em cêntimos. */
const CREDITOS_ANUAIS = 400000;
/** Cut-off anual da taxa normal, em cêntimos. */
const CUT_OFF_ANUAL = 4400000;

/** O acumulado de um emprego anterior — redondo de propósito. */
const ACUMULADO = { bruto: 800000, paye: 60000, usc: 15000 };

/**
 * Este cliente é de demonstração?
 *
 * O código do cadastro é a fonte, e não uma caixa de configuração: uma caixa
 * pode ser ligada por engano num cliente real, e a partir daí a trava deixa de
 * travar. O prefixo `DEMO-` foi a convenção escolhida quando se semeou a
 * demonstração na nuvem, e um cliente real do escritório não se chama assim.
 *
 * Vazio dá `false`: na dúvida, NÃO é de demonstração. O lado seguro do erro é
 * recusar semear, e não semear onde não devia.
 */
export function ehClienteDeDemonstracao(codigo: string | null | undefined): boolean {
  return /^DEMO-/i.test(String(codigo ?? "").trim());
}

export type LinhaDeEnsaio = {
  employer_reg: string;
  tax_year: number;
  employee_ppsn: string;
  employment_id: string;
  rpn_number: string;
  rpn_issue_date: string;
  effective_date: string;
  calculation_basis: string;
  yearly_tax_credits: number;
  yearly_cut_off: number;
  pay_tax_to_date: number;
  tax_deducted_to_date: number;
  pay_usc_to_date: number;
  usc_deducted_to_date: number;
  lpt_to_deduct: number;
  raw: Record<string, unknown>;
  simulated: true;
};

export function rpnDeEnsaio(a: {
  indice: number;
  year: number;
  pps: string;
  employmentId: string;
  employerReg: string;
  comAcumulado: boolean;
  quemPediu: string | null;
  agora?: string;
}): LinhaDeEnsaio {
  const agora = a.agora ?? new Date().toISOString();
  // O RPN nasce a 1 de Janeiro do ano fiscal, como os verdadeiros: um RPN com
  // data de hoje faria a folha de Março parecer que só passou a ter créditos
  // agora, e o cumulativo devolveria imposto de uma vez sem razão nenhuma.
  const inicio = `${a.year}-01-01`;

  return {
    employer_reg: a.employerReg,
    tax_year: a.year,
    employee_ppsn: a.pps,
    employment_id: a.employmentId,
    // `SIM-` sai IMPRESSO no recibo, ao lado dos créditos que ele explica.
    rpn_number: `SIM-${a.year}-${String(a.indice + 1).padStart(3, "0")}`,
    rpn_issue_date: inicio,
    effective_date: inicio,
    calculation_basis: "CUMULATIVE",
    yearly_tax_credits: CREDITOS_ANUAIS,
    yearly_cut_off: CUT_OFF_ANUAL,
    pay_tax_to_date: a.comAcumulado ? ACUMULADO.bruto : 0,
    tax_deducted_to_date: a.comAcumulado ? ACUMULADO.paye : 0,
    pay_usc_to_date: a.comAcumulado ? ACUMULADO.bruto : 0,
    usc_deducted_to_date: a.comAcumulado ? ACUMULADO.usc : 0,
    lpt_to_deduct: 0,
    raw: {
      ensaio: true,
      aviso: "DADOS DE ENSAIO. Nao vieram da Revenue: foram semeados para "
        + "demonstracao num cliente DEMO-. Ver lib/revenue/ensaio.ts.",
      semeado_em: agora,
      semeado_por: a.quemPediu,
    },
    simulated: true,
  };
}
