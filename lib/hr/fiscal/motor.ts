import {
  tabelaDoAno, prsiEmVigor,
  type Cents, type Banda, type TabelaAno, type TabelaUSC, type TabelaPAYE,
} from "./tabelas";

/**
 * O motor de folha irlandês: bruto → PAYE, USC, PRSI, líquido, custo do patrão.
 *
 * ---------------------------------------------------------------------------
 * A COISA QUE QUASE TODA A GENTE ERRA: A BASE CUMULATIVA
 *
 * O PAYE irlandês **não é imposto sobre a semana**. É imposto sobre o ANO ATÉ
 * AQUI, menos o que já foi retido. A conta de uma semana é:
 *
 *     imposto da semana = imposto devido sobre o acumulado
 *                       − imposto já retido no acumulado anterior
 *
 * Calcular cada semana isolada dá o número errado sempre que o salário varia —
 * e ele varia sempre: horas extra, uma semana de férias, um bónus. Pior, o erro
 * **não aparece**: cada semana parece plausível, e a diferença só se descobre
 * no fim do ano, quando a Revenue emite a conta.
 *
 * É também o que faz o sistema devolver dinheiro sozinho. Quem faz 60 horas
 * numa semana e 20 na seguinte paga a mais na primeira e recebe de volta na
 * segunda, sem ninguém fazer nada. Numa base semanal isolada, esse dinheiro
 * ficava perdido até ao acerto anual.
 *
 * O crédito e o cut-off entram **rateados pelo período do ano decorrido** — é o
 * que a Revenue chama cumulative basis. Um crédito anual de €4.000 na semana 10
 * vale 10/52 dele.
 *
 * ---------------------------------------------------------------------------
 * AS TRÊS BASES, E QUANDO CADA UMA SE USA
 *
 *   **cumulativa** — a normal. Precisa do RPN da Revenue e do acumulado do ano.
 *   **semana1** (Week 1 / Month 1) — cada período por si, sem olhar para trás.
 *     A Revenue manda-a quando o passado do contribuinte não é de confiar.
 *   **emergencia** — sem RPN nenhum. As primeiras semanas ainda têm um
 *     cut-off semanal; a partir daí é tudo à taxa superior e sem créditos.
 *     É deliberadamente punitiva, para ninguém se instalar nela.
 *
 * Tudo em CÊNTIMOS INTEIROS. Ver a nota no fim de `tabelas.ts`.
 */

export type Base = "cumulativa" | "semana1" | "emergencia";
export type Situacao = "solteiro" | "familiaMonoparental" | "casadoUmSalario" | "casadoDoisSalarios";

export type Entrada = {
  /** Bruto tributável DESTE período, em cêntimos. */
  brutoPeriodo: Cents;
  /** Data do pagamento (ISO). Escolhe a tabela e a linha de PRSI. */
  dataPagamento: string;
  /** Quantos períodos tem o ano: 52, 26 ou 12. */
  periodosNoAno: 52 | 26 | 12;
  /** Qual período do ano é este, a contar de 1. */
  periodoNo: number;
  base: Base;
  situacao: Situacao;

  /**
   * O que a Revenue mandou no RPN. Quando vem, MANDA sobre a situação familiar
   * — o RPN é a verdade oficial e a situação é o nosso palpite a partir do
   * cadastro.
   */
  rpn?: { cutOffAnual?: Cents; creditosAnuais?: Cents } | null;

  /** Acumulado ANTES deste período. Só a base cumulativa lhe toca. */
  acumuladoAnterior?: {
    bruto: Cents; paye: Cents; usc: Cents; prsiEmpregado: Cents;
  } | null;

  /** Cartão médico completo ou 70+: USC a taxas reduzidas. */
  uscReduzido?: boolean;
  /** Isento de USC por decisão da Revenue (raro, mas existe). */
  isentoUSC?: boolean;
  /** Classe de PRSI. Só A está implementada; ver `NAO_IMPLEMENTADAS`. */
  classePRSI?: string;
};

export type Resultado = {
  brutoPeriodo: Cents;
  paye: Cents;
  usc: Cents;
  prsiEmpregado: Cents;
  prsiEmpregador: Cents;
  /** Bruto − PAYE − USC − PRSI do empregado. */
  liquido: Cents;
  /** Bruto + PRSI do empregador. O que a pessoa custa mesmo. */
  custoEmpregador: Cents;
  acumulado: { bruto: Cents; paye: Cents; usc: Cents; prsiEmpregado: Cents };
  /** Cut-off e créditos que ESTE período usou — o payslip mostra-os. */
  aplicado: { cutOffPeriodo: Cents; creditosPeriodo: Cents; base: Base };
  /** O que impede este número de ser tomado por definitivo. */
  avisos: string[];
};

const r0 = Math.round;

/** Rateio de um valor anual pelo pedaço do ano já decorrido. */
function ateAqui(anual: Cents, periodoNo: number, periodosNoAno: number): Cents {
  return r0((anual * Math.min(periodoNo, periodosNoAno)) / periodosNoAno);
}

/** Imposto por bandas progressivas sobre um valor anualizado. */
function porBandas(valor: Cents, bandas: Banda[]): Cents {
  let restante = valor;
  let anterior = 0;
  let total = 0;
  for (const b of bandas) {
    if (restante <= 0) break;
    const largura = b.ate === null ? restante : Math.max(0, b.ate - anterior);
    const nesta = Math.min(restante, largura);
    total += (nesta * b.taxaBps) / 10000;
    restante -= nesta;
    anterior = b.ate ?? anterior;
  }
  return r0(total);
}

// ---------------------------------------------------------------------- USC

/**
 * USC sobre um acumulado.
 *
 * A ISENÇÃO é um penhasco, e é assim de propósito na lei: quem ganha até
 * €13.000 no ano não paga USC nenhum; quem passa €1 disso paga sobre **tudo**,
 * desde o primeiro euro. Não é um erro de arredondamento — é a regra.
 *
 * Repara-se que o teste é sobre o rendimento ANUAL. Numa base cumulativa a meio
 * do ano compara-se o acumulado anualizado, senão toda a gente ficaria isenta
 * em Janeiro e passaria a pagar em Julho, com um salto brutal.
 */
export function uscSobre(
  acumulado: Cents, tabela: TabelaUSC, periodoNo: number, periodosNoAno: number,
  reduzido: boolean
): Cents {
  const anualizado = periodoNo > 0 ? (acumulado * periodosNoAno) / periodoNo : 0;
  if (anualizado <= tabela.isencaoAnual) return 0;

  const bandas = reduzido && anualizado <= tabela.limiteReduzidas
    ? tabela.bandasReduzidas : tabela.bandas;

  // As bandas são anuais: rateia-se o LIMITE de cada uma pelo ano decorrido, e
  // não o resultado. Ratear no fim empurrava rendimento para bandas erradas.
  const proporcao = Math.min(periodoNo, periodosNoAno) / periodosNoAno;
  const bandasAteAqui = bandas.map((b) => ({
    ate: b.ate === null ? null : r0(b.ate * proporcao),
    taxaBps: b.taxaBps,
  }));
  return porBandas(acumulado, bandasAteAqui);
}

// --------------------------------------------------------------------- PAYE

function cutOffAnual(t: TabelaPAYE, situacao: Situacao): Cents {
  return t.cutOff[situacao] ?? t.cutOff.solteiro;
}

function creditosAnuais(t: TabelaPAYE, situacao: Situacao): Cents {
  const pessoal = situacao === "casadoUmSalario" || situacao === "casadoDoisSalarios"
    ? t.creditos.pessoalCasado : t.creditos.pessoalSolteiro;
  const mono = situacao === "familiaMonoparental" ? t.creditos.familiaMonoparental : 0;
  // O crédito de EMPREGADO é por pessoa e não por emprego: quem tem dois
  // empregos não o recebe duas vezes. Aqui vale sempre uma, e o RPN corrige
  // quando não é o caso.
  return pessoal + t.creditos.empregado + mono;
}

/** Classes de PRSI que este motor ainda não sabe fazer. */
export const NAO_IMPLEMENTADAS = ["B", "C", "D", "H", "J", "K", "M", "P", "S"];

/**
 * A tabela entra por PARÂMETRO, e isso é o que mantém isto puro.
 *
 * Quem manda é o cadastro (`lib/hr/fiscal/tabelasDb.ts`), que lê do banco. Este
 * ficheiro não sabe que existe um banco — recebe a tabela já pronta, ou cai na
 * de fábrica quando ninguém lha dá. É o que permite ao `npm test` exercitar
 * cada conta sem Postgres nenhum de pé.
 */
export function calcular(e: Entrada, tabelaDada?: TabelaAno): Resultado {
  const avisos: string[] = [];
  const ano = Number(e.dataPagamento.slice(0, 4));
  const daFabrica = tabelaDoAno(ano);
  const tabela = tabelaDada ?? daFabrica.tabela;
  const herdada = tabelaDada ? tabela.ano !== ano : daFabrica.herdada;
  if (herdada) {
    avisos.push(`Nao ha tabela fiscal para ${ano}; foi usada a de ${tabela.ano}.`);
  }
  if (!tabela.confirmadoEm) {
    avisos.push(
      `A tabela de ${tabela.ano} ainda NAO foi conferida contra a Revenue. ${tabela.fonte}`
    );
  }

  const classe = (e.classePRSI || "A").toUpperCase().charAt(0);
  if (NAO_IMPLEMENTADAS.includes(classe)) {
    avisos.push(`Classe de PRSI ${classe} nao esta implementada; foi calculada como A.`);
  }

  const anterior = e.base === "cumulativa" && e.acumuladoAnterior
    ? e.acumuladoAnterior
    : { bruto: 0, paye: 0, usc: 0, prsiEmpregado: 0 };

  /*
   * O PERÍODO EFECTIVO.
   *
   * Na base cumulativa a conta é sobre o ano até aqui, e o rateio usa o número
   * do período. Nas outras duas cada período vive sozinho — e ratear por
   * `periodoNo` daria a alguém na semana 40 um cut-off de 40 semanas para uma
   * semana de salário. Por isso ali o período efectivo é sempre 1.
   */
  const cumulativa = e.base === "cumulativa";
  const nPeriodo = cumulativa ? Math.min(e.periodoNo, e.periodosNoAno) : 1;
  const brutoAcum = anterior.bruto + e.brutoPeriodo;

  // ------------------------------------------------------------------ PAYE
  let cutOffPeriodo: Cents;
  let creditosPeriodo: Cents;

  if (e.base === "emergencia") {
    // Sem RPN. As primeiras semanas ainda têm cut-off; depois é tudo a 40%.
    const dentro = e.periodoNo <= tabela.paye.emergencia.semanasComCutOff;
    const semanal = tabela.paye.emergencia.cutOffSemanal;
    cutOffPeriodo = dentro ? r0((semanal * 52) / e.periodosNoAno) : 0;
    creditosPeriodo = 0;
    avisos.push(
      "Base de EMERGENCIA: sem RPN da Revenue. Peca o RPN — assim retem-se a mais de proposito."
    );
  } else {
    const coAnual = e.rpn?.cutOffAnual ?? cutOffAnual(tabela.paye, e.situacao);
    const crAnual = e.rpn?.creditosAnuais ?? creditosAnuais(tabela.paye, e.situacao);
    cutOffPeriodo = ateAqui(coAnual, nPeriodo, e.periodosNoAno);
    creditosPeriodo = ateAqui(crAnual, nPeriodo, e.periodosNoAno);
    if (!e.rpn) {
      avisos.push(
        "Sem RPN: o cut-off e os creditos vieram da situacao familiar do cadastro, nao da Revenue."
      );
    }
  }

  const baseImposto = cumulativa ? brutoAcum : e.brutoPeriodo;
  const aTaxaNormal = Math.min(baseImposto, cutOffPeriodo);
  const aTaxaSuperior = Math.max(0, baseImposto - cutOffPeriodo);
  const brutoImposto = r0(
    (aTaxaNormal * tabela.paye.taxaNormalBps + aTaxaSuperior * tabela.paye.taxaSuperiorBps) / 10000
  );
  // O crédito ABATE o imposto, nunca o torna negativo: crédito a mais não é
  // dinheiro a receber, é crédito que se perde.
  const payeDevido = Math.max(0, brutoImposto - creditosPeriodo);

  /*
   * O acerto. E ele pode ser NEGATIVO — isso é uma devolução, e é correcto.
   *
   * Quem fez 60 horas numa semana e 20 na seguinte pagou a mais na primeira; o
   * cumulativo devolve-lhe na segunda, sozinho. Cortar em zero aqui roubava
   * essa devolução e escondia o erro dentro de um número plausível.
   */
  const paye = cumulativa ? payeDevido - anterior.paye : payeDevido;

  // ------------------------------------------------------------------- USC
  let usc = 0;
  if (!e.isentoUSC) {
    const uscDevido = uscSobre(
      cumulativa ? brutoAcum : e.brutoPeriodo, tabela.usc, nPeriodo, e.periodosNoAno, !!e.uscReduzido
    );
    usc = cumulativa ? uscDevido - anterior.usc : uscDevido;
  }

  // ------------------------------------------------------------------ PRSI
  /*
   * O PRSI é SEMPRE do período, nunca cumulativo — e isso não é um esquecimento.
   *
   * Ele paga seguro social, e o seguro é semana a semana: a isenção dos €352
   * testa-se contra o ganho DAQUELA semana. Quem ganha €300 numa semana e €600
   * na outra não paga na primeira e paga na segunda; a média não interessa.
   */
  const prsi = prsiEmVigor(tabela, e.dataPagamento);
  const semanasNoPeriodo = 52 / e.periodosNoAno;
  const ganhoSemanal = e.brutoPeriodo / semanasNoPeriodo;

  let prsiEmpregado = 0;
  if (ganhoSemanal > prsi.isencaoSemanal) {
    const bruto = (e.brutoPeriodo * prsi.empregadoBps) / 10000;
    /*
     * O crédito que suaviza o degrau. Sem ele, ganhar €1 acima de €352 custava
     * €14,79 de PRSI de uma vez — e a pessoa levava para casa MENOS por ter
     * ganho mais, que é o tipo de coisa que ninguém acredita que é a lei.
     */
    let credito = 0;
    if (ganhoSemanal <= prsi.credito.ateSemanal) {
      const acima = ganhoSemanal - prsi.isencaoSemanal;
      const largura = prsi.credito.ateSemanal - prsi.isencaoSemanal;
      const porSemana = prsi.credito.maximo * (1 - acima / largura);
      credito = porSemana * semanasNoPeriodo;
    }
    prsiEmpregado = Math.max(0, r0(bruto - credito));
  }

  // O escalão do empregador é pelo ganho SEMANAL, e aplica-se a tudo — não é
  // progressivo. Passar o tecto muda a taxa do total, não só do excedente.
  const taxaEmpregador = ganhoSemanal > prsi.empregadorLimiteSemanal
    ? prsi.empregadorSuperiorBps : prsi.empregadorInferiorBps;
  const prsiEmpregador = r0((e.brutoPeriodo * taxaEmpregador) / 10000);

  /*
   * ---------------------------------------------------------------------------
   * O TECTO: um periodo NAO pode reter mais do que a pessoa ganhou.
   *
   * Apanhado a correr a folha a serio, e nao em teste: alguem com acumulado de
   * abertura de 20.014 e PAYE ja retido de zero (o caso de quem migra e ainda
   * nao preencheu o retido) devia, pelo cumulativo, 1.695,21 nesta semana — e a
   * semana valia 660,00. O liquido saiu **-1.401,44**.
   *
   * Nenhum sistema de folha entrega um numero negativo a uma pessoa, e a lei
   * tambem nao o permite: o que nao cabe **transita**. E o cumulativo recolhe-o
   * sozinho no periodo seguinte, porque o retido acumulado fica abaixo do
   * devido e a diferenca volta a aparecer — nao e preciso guardar divida em
   * lado nenhum.
   *
   * A ORDEM do corte nao e arbitraria:
   *
   *   PRSI primeiro, e nunca se corta. Nao e cumulativo, e semana a semana, e
   *   paga seguro social — cortar aqui tirava direitos a pessoa.
   *
   *   USC a seguir, com o que sobrar.
   *
   *   PAYE por ultimo, porque e o UNICO que se corrige sozinho. Cortar o que se
   *   auto-corrige e a escolha que nao deixa divida perdida.
   *
   * Um PAYE NEGATIVO (devolucao) nao se corta: ele AUMENTA o liquido, e cortar
   * uma devolucao seria ficar com dinheiro que nao e nosso.
   */
  let payeFinal = paye;
  let uscFinal = usc;
  const disponivel = e.brutoPeriodo - prsiEmpregado;
  if (disponivel - uscFinal - Math.max(0, payeFinal) < 0) {
    const antes = { paye: payeFinal, usc: uscFinal };
    uscFinal = Math.max(0, Math.min(uscFinal, disponivel));
    if (payeFinal > 0) payeFinal = Math.max(0, disponivel - uscFinal);
    const naoCobrado = (antes.paye - payeFinal) + (antes.usc - uscFinal);
    if (naoCobrado > 0) {
      avisos.push(
        `Nao coube ${(naoCobrado / 100).toFixed(2)} de retencao neste periodo — o bruto nao chegava. `
          + "Transita: o cumulativo recolhe-o no periodo seguinte."
      );
    }
  }

  const liquido = e.brutoPeriodo - payeFinal - uscFinal - prsiEmpregado;

  return {
    brutoPeriodo: e.brutoPeriodo,
    paye: payeFinal, usc: uscFinal, prsiEmpregado, prsiEmpregador,
    liquido,
    custoEmpregador: e.brutoPeriodo + prsiEmpregador,
    acumulado: {
      bruto: brutoAcum,
      // O acumulado soma o que foi MESMO retido. Somar o devido faria o
      // periodo seguinte pensar que ja se tinha cobrado o que nao coube.
      paye: anterior.paye + payeFinal,
      usc: anterior.usc + uscFinal,
      prsiEmpregado: anterior.prsiEmpregado + prsiEmpregado,
    },
    aplicado: { cutOffPeriodo, creditosPeriodo, base: e.base },
    avisos,
  };
}

export const euros = (c: Cents) => c / 100;
