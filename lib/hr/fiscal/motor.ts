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

/**
 * Um aviso é CHAVE + PARÂMETROS, e nunca uma frase pronta.
 *
 * Ficou a frase em português no primeiro corte, e apareceu escrita a meio de um
 * ecrã em inglês — que e a divida que o Alfredo ja tinha marcado. Uma frase
 * montada aqui nao tem como ser traduzida do lado de la: o servidor nao sabe em
 * que idioma esta quem vai ler, e o payslip de um cliente espanhol e lido por
 * quem fala espanhol.
 *
 * Os parametros ja vao formatados (numeros como texto): quem os monta sabe se
 * aquilo e dinheiro, ano ou contagem; o dicionario nao sabe.
 */
export type Aviso = { codigo: string; params?: Record<string, string | number> };
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

  /**
   * SEGURAR a devolução: apura-se, mostra-se, e não se paga neste período.
   *
   * Quem sai da base de emergência recebe de volta o que lá se reteve a mais —
   * às vezes centenas de euros numa única semana. Esse dinheiro sai do bolso do
   * empregador na hora (ele desconta depois no que remete à Revenue), e numa
   * semana de tesouraria apertada isso é um problema real.
   *
   * Não é preciso guardar o VALOR seguro: o cumulativo vê o retido acumulado
   * ainda alto e volta a apurar a devolução no período seguinte, sozinho.
   * Guardar o valor criava uma segunda verdade, que diverge no dia em que a
   * tabela fiscal mudar.
   */
  segurarDevolucao?: boolean;

  /**
   * Auto-enrolment: `true`/`false` = decisão tomada; `undefined` = aplica-se o
   * teste da lei (idade, rendimento, e não ter pensão ocupacional).
   */
  aeInscrito?: boolean;
  /** Para o teste da idade. Sem ela, o teste da idade não corre. */
  dataNascimento?: string | null;
  temPensaoOcupacional?: boolean;
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
  /** Devolução apurada e SEGURA para o período seguinte. Zero quando não há. */
  devolucaoSegura: Cents;
  /** Auto-enrolment: sai do líquido, e NUNCA da base tributável. */
  aeEmpregado: Cents;
  aeEmpregador: Cents;
  /** O que impede este número de ser tomado por definitivo. */
  avisos: Aviso[];
};

const r0 = Math.round;

/**
 * Rateio de um valor anual pelo pedaço do ano já decorrido.
 *
 * ---------------------------------------------------------------------------
 * O ARREDONDAMENTO É POR PERÍODO E PARA CIMA, E ISSO NÃO É DETALHE
 *
 * A conta óbvia — `anual × n / periodos`, arredondada uma vez no fim — dava
 * **€0,22 a menos** de cut-off que o Sage, num payslip real de 2026 do Alfredo:
 * 29.615,38 contra 29.615,60. Vinte e dois cêntimos de cut-off são
 * quatro cêntimos de imposto, e um payslip que não bate ao cêntimo com o do
 * sistema anterior é um payslip que ninguém aceita.
 *
 * A regra a sério é outra: calcula-se o valor **do período**, arredondado para
 * CIMA ao cêntimo, e multiplica-se pelo número do período.
 *
 *     44.000 / 52 = 846,1538  →  846,16  ×35 = 29.615,60  ✓ Sage
 *      4.000 / 52 =  76,9231  →   76,93  ×35 =  2.692,55  ✓ Sage
 *
 * O `76,93` está impresso no próprio payslip, no campo TAX CREDIT — é o
 * semanal, e é dele que sai o acumulado. Arredondar para cima favorece o
 * contribuinte, que é o lado para que a Revenue arredonda.
 */
function ateAqui(anual: Cents, periodoNo: number, periodosNoAno: number): Cents {
  const doPeriodo = Math.ceil(anual / periodosNoAno);
  return doPeriodo * Math.min(periodoNo, periodosNoAno);
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

  /*
   * As bandas são anuais: rateia-se o LIMITE de cada uma, e não o resultado —
   * ratear no fim empurrava rendimento para bandas erradas.
   *
   * E rateia-se com a MESMA regra do cut-off: valor do período arredondado para
   * cima, vezes o número do período. Ver `ateAqui`.
   */
  const bandasAteAqui = bandas.map((b) => ({
    ate: b.ate === null ? null : ateAqui(b.ate, periodoNo, periodosNoAno),
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
  const avisos: Aviso[] = [];
  const ano = Number(e.dataPagamento.slice(0, 4));
  const daFabrica = tabelaDoAno(ano);
  const tabela = tabelaDada ?? daFabrica.tabela;
  const herdada = tabelaDada ? tabela.ano !== ano : daFabrica.herdada;
  if (herdada) {
    avisos.push({ codigo: "aviso.tabelaHerdada", params: { ano, usada: tabela.ano } });
  }
  if (!tabela.confirmadoEm) {
    avisos.push({ codigo: "aviso.tabelaPorConferir", params: { ano: tabela.ano, fonte: tabela.fonte } });
  }

  const classe = (e.classePRSI || "A").toUpperCase().charAt(0);
  if (NAO_IMPLEMENTADAS.includes(classe)) {
    avisos.push({ codigo: "aviso.classePrsi", params: { classe } });
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
    avisos.push({ codigo: "aviso.emergencia" });
  } else {
    const coAnual = e.rpn?.cutOffAnual ?? cutOffAnual(tabela.paye, e.situacao);
    const crAnual = e.rpn?.creditosAnuais ?? creditosAnuais(tabela.paye, e.situacao);
    cutOffPeriodo = ateAqui(coAnual, nPeriodo, e.periodosNoAno);
    creditosPeriodo = ateAqui(crAnual, nPeriodo, e.periodosNoAno);
    if (!e.rpn) {
      avisos.push({ codigo: "aviso.semRpn" });
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
  /*
   * ---------------------------------------------------------------------------
   * AUTO-ENROLMENT — e a regra que mais se erra
   *
   * A contribuição do empregado **não desgrava**. Ela sai do LÍQUIDO, depois de
   * PAYE, USC e PRSI, e nunca reduz o rendimento tributável — o Estado põe um
   * bónus por cima em vez de dar desgravação, ao contrário de um PRSA.
   *
   * O payslip do Sage prova-o: GROSS PAY 22.241,26 e TAXABLE PAY 22.241,26,
   * iguais ao cêntimo, com 333,66 de AE já descontados no acumulado.
   *
   * Quem a trata como pensão normal desconta-a antes do imposto e dá um PAYE
   * mais baixo do que o devido — todas as semanas, a toda a gente, sem dar erro.
   * Por isso este bloco vem DEPOIS de tudo, e é o último a mexer no líquido.
   */
  let aeEmpregado = 0;
  let aeEmpregador = 0;
  if (tabela.ae && e.dataPagamento >= tabela.ae.desde) {
    const ae = tabela.ae;
    const anualizado = (e.brutoPeriodo * e.periodosNoAno);

    /*
     * A decisão MANDA sobre o teste.
     *
     * `aeInscrito` definido é alguém que decidiu — opt-out, ou uma inscrição
     * feita à mão. Só quando ninguém decidiu é que se aplicam os três testes da
     * lei. Deixar o teste ganhar apagava a escolha da pessoa a cada folha.
     */
    let inscrito: boolean;
    if (e.aeInscrito !== undefined) {
      inscrito = e.aeInscrito;
    } else if (e.temPensaoOcupacional) {
      // Quem já tem pensão da empresa fica fora, por lei.
      inscrito = false;
    } else {
      const idade = e.dataNascimento
        ? Math.floor(
          (new Date(e.dataPagamento).getTime() - new Date(e.dataNascimento).getTime())
          / (365.25 * 24 * 3600 * 1000))
        : null;
      const idadeOk = idade === null ? true : idade >= ae.idadeMinima && idade <= ae.idadeMaxima;
      if (idade === null) {
        // Sem data de nascimento o teste da idade não corre. Diz-se, em vez de
        // deixar passar em silêncio uma inscrição que pode estar errada.
        avisos.push({ codigo: "aviso.aeSemIdade" });
      }
      inscrito = idadeOk && anualizado >= ae.rendimentoMinimoAnual;
    }

    if (inscrito) {
      // O tecto é sobre o rendimento ANUAL: rateia-se para este período.
      const tectoPeriodo = Math.floor(ae.tectoRendimento / e.periodosNoAno);
      const base = Math.min(e.brutoPeriodo, tectoPeriodo);
      aeEmpregado = r0((base * ae.empregadoBps) / 10000);
      aeEmpregador = r0((base * ae.empregadorBps) / 10000);
    }
  }


  let payeFinal = paye;
  let uscFinal = usc;

  /*
   * A devolução SEGURA entra antes do tecto, e a ordem importa.
   *
   * Segurar uma devolução deixa o líquido igual ao de uma semana sem
   * devolução — que é exactamente o efeito desejado. Se corresse depois do
   * tecto, o tecto teria calculado com um PAYE negativo e concluído que cabia
   * tudo, e a conta saía errada.
   */
  let devolucaoSegura = 0;
  if (e.segurarDevolucao && payeFinal < 0) {
    devolucaoSegura = -payeFinal;
    payeFinal = 0;
    avisos.push({
      codigo: "aviso.devolucaoSegura",
      params: { v: (devolucaoSegura / 100).toFixed(2) },
    });
  }
  /*
   * A AE entra no que JÁ NÃO ESTÁ disponível, ao lado do PRSI.
   *
   * Apanhado por um teste que passava e deixou de passar: com a AE descontada
   * DEPOIS do tecto, o tecto concluía que cabia tudo e o líquido saía a −9,90.
   * PRSI e AE são os dois fixos e não cumulativos — não há nada neles que se
   * corrija sozinho depois —, então são os dois que o tecto tem de respeitar,
   * e são o USC e o PAYE que absorvem o aperto.
   */
  const disponivel = e.brutoPeriodo - prsiEmpregado - aeEmpregado;
  if (disponivel - uscFinal - Math.max(0, payeFinal) < 0) {
    const antes = { paye: payeFinal, usc: uscFinal };
    uscFinal = Math.max(0, Math.min(uscFinal, disponivel));
    if (payeFinal > 0) payeFinal = Math.max(0, disponivel - uscFinal);
    const naoCobrado = (antes.paye - payeFinal) + (antes.usc - uscFinal);
    if (naoCobrado > 0) {
      avisos.push({ codigo: "aviso.naoCoube", params: { v: (naoCobrado / 100).toFixed(2) } });
    }
  }

  const liquido = e.brutoPeriodo - payeFinal - uscFinal - prsiEmpregado - aeEmpregado;

  return {
    brutoPeriodo: e.brutoPeriodo,
    paye: payeFinal, usc: uscFinal, prsiEmpregado, prsiEmpregador,
    liquido,
    // O que a pessoa custa mesmo: bruto + PRSI patronal + AE patronal.
    custoEmpregador: e.brutoPeriodo + prsiEmpregador + aeEmpregador,
    acumulado: {
      bruto: brutoAcum,
      // O acumulado soma o que foi MESMO retido. Somar o devido faria o
      // periodo seguinte pensar que ja se tinha cobrado o que nao coube.
      paye: anterior.paye + payeFinal,
      usc: anterior.usc + uscFinal,
      prsiEmpregado: anterior.prsiEmpregado + prsiEmpregado,
    },
    aplicado: { cutOffPeriodo, creditosPeriodo, base: e.base },
    devolucaoSegura,
    aeEmpregado, aeEmpregador,
    avisos,
  };
}

export const euros = (c: Cents) => c / 100;
