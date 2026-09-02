/**
 * As tabelas fiscais irlandesas — DADOS, não código.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO É UMA TABELA E NÃO UMAS CONSTANTES
 *
 * As taxas mudam **todos os anos** no Orçamento de Outubro, e o PRSI já mudou
 * **a meio do ano** duas vezes seguidas (1 de Outubro de 2024 e 1 de Outubro de
 * 2025). Um sistema que traz os números escritos no meio da conta obriga a uma
 * alteração de código — e a um `deploy` — a cada mudança, e a folha de Janeiro
 * não espera por isso.
 *
 * Pior: com os números espalhados pelo código, recalcular Novembro do ano
 * passado passa a dar o resultado deste ano. Um recálculo tem de usar a tabela
 * **da data do pagamento**, e não a tabela de hoje.
 *
 * ---------------------------------------------------------------------------
 * O QUE `confirmadoEm` SIGNIFICA, E POR QUE EXISTE
 *
 * Cada tabela diz quando foi conferida contra a publicação da Revenue, e por
 * quem. **Uma tabela sem confirmação continua a calcular** — recusar deixaria o
 * escritório sem folha nenhuma, que é pior — mas o resultado sai marcado, e o
 * ecrã mostra o aviso.
 *
 * É a mesma regra da verificação de actualizações: um sistema que não sabe se
 * está certo tem de o dizer, e não pode dar a garantia sem a fazer. Um número
 * de imposto errado não dá erro — dá um líquido plausível e uma dívida à
 * Revenue que aparece meses depois.
 *
 * **Antes da primeira folha a sério, cada tabela abaixo tem de ser conferida
 * linha a linha contra revenue.ie e marcada aqui.**
 */

/** Tudo em CÊNTIMOS inteiros. Ver a nota sobre dinheiro no fim do ficheiro. */
export type Cents = number;

export type Banda = {
  /** Limite SUPERIOR da banda, em cêntimos/ano. `null` = daí para cima. */
  ate: Cents | null;
  /** Milésimos de por cento, para 0,5% caber sem vírgula: 0,5% = 50. */
  taxaBps: number;
};

export type TabelaUSC = {
  bandas: Banda[];
  /** Rendimento anual até ao qual NÃO se paga USC nenhum. */
  isencaoAnual: Cents;
  /**
   * Bandas de quem tem cartão médico completo ou 70+ anos com rendimento
   * abaixo do limite. A lei chama-lhes "reduced rates".
   */
  bandasReduzidas: Banda[];
  /** Rendimento acima do qual as reduzidas deixam de se aplicar. */
  limiteReduzidas: Cents;
};

export type TabelaPAYE = {
  taxaNormalBps: number;
  taxaSuperiorBps: number;
  /** Cut-off anual por situação familiar. */
  cutOff: {
    solteiro: Cents;
    familiaMonoparental: Cents;
    casadoUmSalario: Cents;
    /** Base do casal com dois salários; o segundo acresce até `acrescimoMax`. */
    casadoDoisSalarios: Cents;
    acrescimoMax: Cents;
  };
  creditos: {
    pessoalSolteiro: Cents;
    pessoalCasado: Cents;
    empregado: Cents;
    familiaMonoparental: Cents;
  };
  /**
   * Emergency basis: sem RPN, o cut-off é zero a partir da 5.ª semana e tudo é
   * tributado à taxa superior. As primeiras 4 semanas têm cut-off semanal.
   */
  emergencia: { semanasComCutOff: number; cutOffSemanal: Cents };
};

export type TabelaPRSI = {
  /** A partir de quando esta linha vale (ISO). O PRSI muda a meio do ano. */
  desde: string;
  empregadoBps: number;
  /** Ganho SEMANAL até ao qual o empregado não paga nada. */
  isencaoSemanal: Cents;
  /**
   * O crédito que suaviza o degrau logo acima da isenção.
   * Sem ele, ganhar €1 a mais que €352 custava €14,50 de PRSI de uma vez.
   */
  credito: { maximo: Cents; ateSemanal: Cents };
  /** Escalão inferior do empregador, e o tecto semanal dele. */
  empregadorInferiorBps: number;
  empregadorSuperiorBps: number;
  empregadorLimiteSemanal: Cents;
};

/**
 * Auto-enrolment ("My Future Fund").
 *
 * A regra que mais se erra: a contribuição do empregado **não desgrava**. Ela
 * sai do líquido, depois do imposto, e nunca reduz o rendimento tributável — o
 * Estado põe um bónus por cima em vez de dar desgravação.
 *
 * O payslip do Sage prova-o: GROSS PAY e TAXABLE PAY iguais ao cêntimo, com a
 * AE já descontada. Tratá-la como um PRSA dava um PAYE mais baixo do que o
 * devido, todas as semanas, a toda a gente, sem dar erro nenhum.
 */
export type TabelaAE = {
  desde: string;
  empregadoBps: number;
  empregadorBps: number;
  /** O bónus do Estado. Não passa pela folha — fica aqui para o payslip o dizer. */
  estadoBps: number;
  /** Os três testes que decidem a inscrição automática. */
  rendimentoMinimoAnual: Cents;
  tectoRendimento: Cents;
  idadeMinima: number;
  idadeMaxima: number;
};

export type TabelaAno = {
  ano: number;
  paye: TabelaPAYE;
  usc: TabelaUSC;
  /** Ordenada por `desde`. A folha usa a linha em vigor na data do pagamento. */
  prsi: TabelaPRSI[];
  /** Auto-enrolment em vigor. `null` antes de o esquema existir. */
  ae: TabelaAE | null;
  /** `null` = ainda não foi conferida contra a Revenue. */
  confirmadoEm: string | null;
  fonte: string;
};

const eur = (v: number): Cents => Math.round(v * 100);

/*
 * 2025 — o ano de referência.
 *
 * Os números vêm do Orçamento 2025 e das alterações de PRSI de 1 de Outubro de
 * 2025. Continuam por conferir linha a linha contra revenue.ie.
 */
const A2025: TabelaAno = {
  ano: 2025,
  paye: {
    taxaNormalBps: 2000,
    taxaSuperiorBps: 4000,
    cutOff: {
      solteiro: eur(44000),
      familiaMonoparental: eur(48000),
      casadoUmSalario: eur(53000),
      casadoDoisSalarios: eur(53000),
      acrescimoMax: eur(35000),
    },
    creditos: {
      pessoalSolteiro: eur(2000),
      pessoalCasado: eur(4000),
      empregado: eur(2000),
      familiaMonoparental: eur(1900),
    },
    emergencia: { semanasComCutOff: 4, cutOffSemanal: eur(44000 / 52) },
  },
  usc: {
    bandas: [
      { ate: eur(12012), taxaBps: 50 },
      { ate: eur(27382), taxaBps: 200 },
      { ate: eur(70044), taxaBps: 300 },
      { ate: null, taxaBps: 800 },
    ],
    isencaoAnual: eur(13000),
    bandasReduzidas: [
      { ate: eur(12012), taxaBps: 50 },
      { ate: null, taxaBps: 200 },
    ],
    limiteReduzidas: eur(60000),
  },
  prsi: [
    {
      desde: "2025-01-01",
      empregadoBps: 410,
      isencaoSemanal: eur(352),
      credito: { maximo: eur(12), ateSemanal: eur(424) },
      empregadorInferiorBps: 890,
      empregadorSuperiorBps: 1115,
      empregadorLimiteSemanal: eur(496),
    },
    {
      // A subida de Outubro. É por isto que a tabela tem datas.
      desde: "2025-10-01",
      empregadoBps: 420,
      isencaoSemanal: eur(352),
      credito: { maximo: eur(12), ateSemanal: eur(424) },
      empregadorInferiorBps: 900,
      empregadorSuperiorBps: 1125,
      empregadorLimiteSemanal: eur(496),
    },
  ],
  // O auto-enrolment só arranca em 2026.
  ae: null,
  confirmadoEm: null,
  fonte: "Orcamento 2025 + alteracoes PRSI de 01-10-2025. POR CONFERIR contra revenue.ie.",
};

/*
 * 2026 — herda 2025 e ESPERA CONFIRMAÇÃO.
 *
 * Herdar em vez de inventar é deliberado: um palpite sobre o Orçamento 2026
 * seria um número errado com ar de número certo, e um número desses não dá
 * erro — dá um líquido plausível e uma dívida à Revenue meses depois. Repetir
 * 2025 é uma escolha visivelmente conservadora, e o aviso na tela diz que
 * ainda não foi conferida.
 */
const A2026: TabelaAno = {
  ...A2025,
  ano: 2026,
  /*
   * O TECTO DA BANDA DE 2% DO USC SUBIU: 27.382 → 28.700.
   *
   * Não é palpite. Saiu de um payslip REAL do Sage de 2026 (semana 35, pago a
   * 02-09-2026): USC acumulado de 352,79 sobre 22.241,26 de bruto. Com o tecto
   * de 2025 dava 361,66; com 28.700 dá 352,79 — erro de menos de meio cêntimo.
   *
   * Fecha com o resto: no mesmo payslip o cut-off (44.000) e os créditos
   * (4.000) batem ao cêntimo, e o PRSI dos dois lados também. É a única peça
   * que estava fora, e 28.700 é número redondo, como estas coisas costumam ser.
   *
   * Continua POR CONFERIR contra revenue.ie — um payslip é uma evidência forte,
   * não é a publicação oficial.
   */
  usc: { ...A2025.usc, bandas: [
    { ate: eur(12012), taxaBps: 50 },
    { ate: eur(28700), taxaBps: 200 },
    { ate: eur(70044), taxaBps: 300 },
    { ate: null, taxaBps: 800 },
  ] },
  prsi: [
    {
      desde: "2026-01-01",
      empregadoBps: 420,
      isencaoSemanal: eur(352),
      credito: { maximo: eur(12), ateSemanal: eur(424) },
      empregadorInferiorBps: 900,
      empregadorSuperiorBps: 1125,
      empregadorLimiteSemanal: eur(496),
    },
  ],
  ae: {
    desde: "2026-01-01",
    // Fase 1 (anos 1-3). Confere com o payslip: 9,81 sobre 653,85 = 1,5%.
    empregadoBps: 150, empregadorBps: 150, estadoBps: 50,
    rendimentoMinimoAnual: eur(20000),
    tectoRendimento: eur(80000),
    idadeMinima: 23, idadeMaxima: 60,
  },
  confirmadoEm: null,
  fonte: "Base de 2025 + tecto do USC de 2% a 28.700, deduzido de um payslip Sage real de 2026. "
    + "O resto do Orcamento 2026 NAO foi aplicado. Conferir contra revenue.ie.",
};

const TABELAS: Record<number, TabelaAno> = { 2025: A2025, 2026: A2026 };

/**
 * A tabela do ano, ou a mais recente que se conhece.
 *
 * Cair na mais recente em vez de rebentar é a escolha certa aqui: uma folha que
 * não corre por falta de tabela é um escritório parado, e o aviso de "não
 * confirmada" já diz o que é preciso saber. `herdada` distingue os dois casos
 * para o ecrã poder ser mais específico.
 */
export function tabelaDoAno(ano: number): { tabela: TabelaAno; herdada: boolean } {
  const exacta = TABELAS[ano];
  if (exacta) return { tabela: exacta, herdada: false };
  const anos = Object.keys(TABELAS).map(Number).sort((a, b) => a - b);
  const maisProximo = anos.filter((a) => a <= ano).pop() ?? anos[0];
  return { tabela: TABELAS[maisProximo], herdada: true };
}

/** A linha de PRSI em vigor na data do pagamento. */
export function prsiEmVigor(tabela: TabelaAno, dataPagamento: string): TabelaPRSI {
  const validas = tabela.prsi.filter((p) => p.desde <= dataPagamento);
  // Data anterior à primeira linha (recálculo de um ano antigo): usa a primeira,
  // que é a mais benigna, em vez de não haver PRSI nenhum.
  return validas.length ? validas[validas.length - 1] : tabela.prsi[0];
}

export const anosConhecidos = () => Object.keys(TABELAS).map(Number).sort((a, b) => a - b);

/*
 * ---------------------------------------------------------------------------
 * DINHEIRO É CÊNTIMO INTEIRO, E ISSO NÃO É PREFERÊNCIA
 *
 * O módulo de contabilidade já pagou esta lição (`lib/accounting/post.ts`):
 * três linhas de €33,333 dão €99,99 numa nota de €100,00. Na folha é pior,
 * porque o erro não fica num relatório — vai para a conta bancária de uma
 * pessoa e para uma declaração à Revenue.
 *
 * Por isso tudo aqui é `Cents`, e a única divisão que arredonda é a que produz
 * o valor final do período.
 */
