/**
 * O motor de folha irlandes — teste.
 *
 * A demo do Matheus NAO calcula imposto nenhum (PAYE, PRSI, net pay, tax
 * credit e RPN dao zero ocorrencias no ficheiro dele). Entao isto nao e uma
 * traducao como `lib/hr/payroll.ts` — e codigo novo, e o unico chao firme sao
 * as regras da Revenue e estes testes.
 *
 * O que se prova aqui, por ordem de gravidade:
 *
 *   1. a base CUMULATIVA, que e o que quase toda a gente erra;
 *   2. a devolucao automatica quando o salario cai;
 *   3. o penhasco da isencao de USC;
 *   4. o degrau do PRSI e o credito que o suaviza;
 *   5. os avisos, que sao o que impede um numero por confirmar de passar por
 *      confirmado.
 */
const { calcular, uscSobre, euros } = require("../.test-build/hr/fiscal/motor");
const { tabelaDoAno, prsiEmVigor, anosConhecidos } = require("../.test-build/hr/fiscal/tabelas");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
const perto = (a, b, tol = 2) => Math.abs(a - b) <= tol;
/*
 * O aviso e {codigo, params}, e o teste confere o CODIGO.
 *
 * A frase mudou-se para o dicionario (en/pt/es) porque o servidor nao sabe em
 * que idioma esta quem vai ler. Testar a frase passava a testar a traducao, e
 * quebrava a cada retoque de texto.
 */
const temAviso = (r, codigo) => r.avisos.some((a) => a.codigo === codigo);
const codigos = (r) => r.avisos.map((a) => a.codigo);
const eur = (v) => Math.round(v * 100);

const BASE = {
  dataPagamento: "2026-03-05", periodosNoAno: 52, periodoNo: 10,
  base: "cumulativa", situacao: "solteiro",
};

console.log("\n== a base cumulativa: imposto sobre o ANO, menos o ja retido ==");
{
  /*
   * Solteiro, EUR 800/semana, semana 10.
   *
   * O rateio NAO e `anual x 10 / 52`. E o valor SEMANAL arredondado para CIMA,
   * vezes 10 — regra que so descobri ao bater o motor contra um payslip real do
   * Sage (ver o bloco no fim deste ficheiro). Escrevi estas tres asseroes com a
   * conta obvia e as tres estavam erradas por cents.
   *
   *   cut-off:  ceil(44.000/52) = 846,16  x10 = 8.461,60
   *   creditos: ceil( 4.000/52) =  76,93  x10 =   769,30
   *   imposto devido: 20% de 8.000 = 1.600; menos 769,30 = 830,70
   *   ja retido 747,69 -> a semana paga 83,01
   */
  const r = calcular({
    ...BASE, brutoPeriodo: eur(800),
    acumuladoAnterior: { bruto: eur(7200), paye: eur(747.69), usc: 0, prsiEmpregado: 0 },
  });
  ok(perto(r.aplicado.cutOffPeriodo, eur(846.16 * 10)), "cut-off = semanal arredondado para cima x 10",
     euros(r.aplicado.cutOffPeriodo));
  ok(perto(r.aplicado.creditosPeriodo, eur(76.93 * 10)), "creditos = semanal arredondado para cima x 10",
     euros(r.aplicado.creditosPeriodo));
  ok(perto(r.paye, eur(83.01)), "PAYE da semana = devido no acumulado - ja retido", euros(r.paye));

  // A mesma pessoa em Week 1 basis: a semana vive sozinha.
  // cut-off 846,16 -> os 800 todos a 20% = 160; menos 76,93 de credito = 83,07.
  const w1 = calcular({ ...BASE, base: "semana1", brutoPeriodo: eur(800) });
  ok(perto(w1.paye, eur(83.07)), "Week 1 da quase o mesmo quando o salario e constante", euros(w1.paye));
}

console.log("\n== a devolucao que o cumulativo faz sozinho ==");
{
  // 60h numa semana (EUR 1.500) e 20h na seguinte (EUR 500). Numa base semanal
  // isolada a pessoa pagava a mais na primeira e o dinheiro ficava perdido ate
  // ao acerto anual. No cumulativo volta na semana seguinte.
  const s1 = calcular({
    ...BASE, periodoNo: 20, brutoPeriodo: eur(1500),
    acumuladoAnterior: { bruto: eur(19 * 800), paye: eur(1578.46), usc: 0, prsiEmpregado: 0 },
  });
  const s2 = calcular({
    ...BASE, periodoNo: 21, brutoPeriodo: eur(500),
    acumuladoAnterior: {
      bruto: eur(19 * 800) + eur(1500), paye: eur(1578.46) + s1.paye, usc: 0, prsiEmpregado: 0,
    },
  });
  ok(s1.paye > eur(200), "a semana grande retem mais", euros(s1.paye));
  ok(s2.paye < s1.paye, "e a semana pequena retem menos", euros(s2.paye));

  // O caso a serio: uma semana de ZERO depois de muito trabalho devolve.
  const s3 = calcular({
    ...BASE, periodoNo: 22, brutoPeriodo: 0,
    acumuladoAnterior: {
      bruto: eur(19 * 800) + eur(2000), paye: eur(1578.46) + s1.paye + s2.paye,
      usc: 0, prsiEmpregado: 0,
    },
  });
  ok(s3.paye < 0, "semana sem trabalho DEVOLVE imposto — nao corta em zero", euros(s3.paye));
}

console.log("\n== o penhasco da isencao de USC ==");
{
  const { tabela } = tabelaDoAno(2026);
  /*
   * Ate 13.000/ano nao se paga NADA. Um euro acima e paga-se sobre TUDO — mas
   * PELAS BANDAS, e nao a uma taxa unica.
   *
   * Escrevi este teste a espera de um numero grande (">200") e ele deu 79,84.
   * O motor estava certo e a minha suposicao errada: 0,5% de 12.012 = 60,06,
   * mais 2% dos 989 que passam = 19,78. O penhasco existe — de zero para 79,84
   * por causa de UM euro — mas nao e um penhasco de centenas.
   */
  const abaixo = uscSobre(eur(12999), tabela.usc, 52, 52, false);
  const acima = uscSobre(eur(13001), tabela.usc, 52, 52, false);
  const esperadoNoPenhasco = eur(12012 * 0.005 + (13001 - 12012) * 0.02);
  ok(abaixo === 0, "12.999/ano: zero USC", euros(abaixo));
  ok(perto(acima, esperadoNoPenhasco, 5),
     "13.001/ano: paga sobre TUDO, mas pelas bandas — 79,84 e nao uma taxa unica",
     [euros(acima), euros(esperadoNoPenhasco)]);
  ok(acima > 0 && abaixo === 0, "e o salto por causa de UM euro e real");

  /*
   * As bandas de 2026: 0,5% ate 12.012 · 2% ate **28.700** · 3% ate 70.044 · 8%.
   *
   * O tecto de 28.700 nao veio de mim: saiu do payslip real do Sage, onde o USC
   * acumulado so fecha com ele. Escrevi este teste com os 27.382 de 2025 e ele
   * ficou a acusar o motor de estar errado quando o errado era o meu numero.
   */
  const em30k = uscSobre(eur(30000), tabela.usc, 52, 52, false);
  const esperado = eur(12012 * 0.005 + (28700 - 12012) * 0.02 + (30000 - 28700) * 0.03);
  ok(perto(em30k, esperado, 5), "30.000/ano bate com as bandas", [euros(em30k), euros(esperado)]);

  // Taxas reduzidas (cartao medico / 70+): so 0,5% e 2%.
  const reduzido = uscSobre(eur(30000), tabela.usc, 52, 52, true);
  ok(reduzido < em30k, "taxas reduzidas pagam menos", [euros(reduzido), euros(em30k)]);
}

console.log("\n== o degrau do PRSI, e o credito que o suaviza ==");
{
  const p = { ...BASE, base: "semana1", situacao: "solteiro" };
  const isento = calcular({ ...p, brutoPeriodo: eur(352) });
  ok(isento.prsiEmpregado === 0, "ate 352/semana o empregado nao paga", euros(isento.prsiEmpregado));

  const logoAcima = calcular({ ...p, brutoPeriodo: eur(360) });
  ok(logoAcima.prsiEmpregado > 0, "acima de 352 ja paga");
  // Sem o credito, 360 x 4,2% = 15,12 de uma vez. Com ele, muito menos.
  ok(logoAcima.prsiEmpregado < eur(15.12) * 0.5,
     "mas o credito corta o degrau quase todo", euros(logoAcima.prsiEmpregado));

  /*
   * O DEGRAU RESIDUAL É REAL, E É DA LEI.
   *
   * Escrevi este teste a afirmar que ganhar mais nunca pode levar menos para
   * casa, e ele falhou: aos 352,00 o liquido e 348,42; aos 352,01 e 345,64.
   * Fui conferir esperando um erro meu, e o erro era a afirmacao.
   *
   * O credito de PRSI TAPERA o degrau, nao o elimina: sem ele o salto seria de
   * 14,78; com ele fica em 2,79. A lei irlandesa aceita essa faixa curta em que
   * ganhar um cêntimo a mais custa dinheiro.
   *
   * Fica escrito porque a proxima pessoa que olhar para isto vai ter a mesma
   * reaccao que eu tive, e vai querer "corrigir" o motor.
   */
  const a = calcular({ ...p, brutoPeriodo: eur(352) });
  const b = calcular({ ...p, brutoPeriodo: eur(352.01) });
  const semCredito = eur(352.01 * 0.042);
  ok(b.liquido < a.liquido, "o degrau existe mesmo: 352,01 leva menos para casa que 352,00",
     [euros(a.liquido), euros(b.liquido)]);
  ok(b.prsiEmpregado < semCredito * 0.25,
     "mas o credito corta mais de 3/4 dele — 2,79 em vez de 14,78",
     [euros(b.prsiEmpregado), euros(semCredito)]);

  // E a partir dos 424 o credito acabou, e dai para cima e sempre monotono.
  const c = calcular({ ...p, brutoPeriodo: eur(424) });
  const d = calcular({ ...p, brutoPeriodo: eur(425) });
  ok(d.liquido > c.liquido, "acima de 424 ganhar mais leva sempre mais para casa",
     [euros(c.liquido), euros(d.liquido)]);

  // Acima de 424 o credito acabou: 4,2% cheios.
  const cheio = calcular({ ...p, brutoPeriodo: eur(800) });
  ok(perto(cheio.prsiEmpregado, eur(800 * 0.042)), "acima de 424 e a taxa cheia",
     euros(cheio.prsiEmpregado));
}

console.log("\n== o PRSI do empregador ==");
{
  const p = { ...BASE, base: "semana1" };
  const baixo = calcular({ ...p, brutoPeriodo: eur(400) });
  ok(perto(baixo.prsiEmpregador, eur(400 * 0.09)), "ate 496/semana: 9%", euros(baixo.prsiEmpregador));

  // Nao e progressivo: passar o tecto muda a taxa do TOTAL, nao so do excedente.
  const alto = calcular({ ...p, brutoPeriodo: eur(500) });
  ok(perto(alto.prsiEmpregador, eur(500 * 0.1125)), "acima de 496: 11,25% sobre TUDO",
     euros(alto.prsiEmpregador));

  // Desde a AE Pension, o custo tambem leva a contribuicao patronal dela.
  ok(alto.custoEmpregador === alto.brutoPeriodo + alto.prsiEmpregador + alto.aeEmpregador,
     "custo do empregador = bruto + PRSI dele + AE dele",
     [euros(alto.custoEmpregador), euros(alto.brutoPeriodo + alto.prsiEmpregador + alto.aeEmpregador)]);
}

console.log("\n== o PRSI muda a meio do ano, e a tabela tem datas ==");
{
  const { tabela } = tabelaDoAno(2025);
  const antes = prsiEmVigor(tabela, "2025-09-30");
  const depois = prsiEmVigor(tabela, "2025-10-01");
  ok(antes.empregadoBps === 410 && depois.empregadoBps === 420,
     "1 de Outubro de 2025 subiu o empregado de 4,1% para 4,2%",
     [antes.empregadoBps, depois.empregadoBps]);
  ok(depois.empregadorSuperiorBps > antes.empregadorSuperiorBps, "e o do empregador tambem");

  // Recalcular Setembro tem de usar a tabela de Setembro, nao a de hoje.
  const set = calcular({ ...BASE, base: "semana1", dataPagamento: "2025-09-15", brutoPeriodo: eur(800) });
  const out = calcular({ ...BASE, base: "semana1", dataPagamento: "2025-10-15", brutoPeriodo: eur(800) });
  ok(set.prsiEmpregado < out.prsiEmpregado,
     "recalcular Setembro usa a tabela de Setembro", [euros(set.prsiEmpregado), euros(out.prsiEmpregado)]);
}

console.log("\n== base de emergencia: punitiva de proposito ==");
{
  const normal = calcular({ ...BASE, base: "semana1", brutoPeriodo: eur(800) });
  const emerg = calcular({ ...BASE, base: "emergencia", periodoNo: 10, brutoPeriodo: eur(800) });
  ok(emerg.paye > normal.paye * 3, "sem RPN retem-se MUITO mais",
     [euros(normal.paye), euros(emerg.paye)]);
  ok(emerg.aplicado.creditosPeriodo === 0, "e sem creditos nenhuns");
  ok(temAviso(emerg, "aviso.emergencia"), "e o aviso diz para pedir o RPN", codigos(emerg));

  // Nas primeiras semanas ainda ha cut-off; depois nao.
  const cedo = calcular({ ...BASE, base: "emergencia", periodoNo: 2, brutoPeriodo: eur(800) });
  ok(cedo.aplicado.cutOffPeriodo > 0, "as primeiras 4 semanas ainda tem cut-off");
  ok(emerg.aplicado.cutOffPeriodo === 0, "da 5.a em diante e tudo a taxa superior");
}

console.log("\n== o RPN manda sobre o cadastro ==");
{
  const doCadastro = calcular({ ...BASE, base: "semana1", brutoPeriodo: eur(800) });
  const daRevenue = calcular({
    ...BASE, base: "semana1", brutoPeriodo: eur(800),
    rpn: { cutOffAnual: eur(20000), creditosAnuais: eur(1000) },
  });
  ok(daRevenue.paye > doCadastro.paye, "o RPN substitui o palpite da situacao familiar",
     [euros(doCadastro.paye), euros(daRevenue.paye)]);
  ok(!temAviso(daRevenue, "aviso.semRpn"), "e o aviso de 'sem RPN' desaparece", codigos(daRevenue));
  ok(temAviso(doCadastro, "aviso.semRpn"), "sem ele, o aviso aparece", codigos(doCadastro));
}

console.log("\n== os avisos, que impedem um numero por confirmar de passar por confirmado ==");
{
  const r = calcular({ ...BASE, base: "semana1", brutoPeriodo: eur(800) });
  ok(temAviso(r, "aviso.tabelaPorConferir"),
     "a tabela por confirmar diz-se por confirmar", codigos(r));

  // Ano sem tabela: usa a mais proxima E avisa. Nao rebenta — uma folha que nao
  // corre por falta de tabela e um escritorio parado.
  const futuro = calcular({ ...BASE, base: "semana1", dataPagamento: "2031-03-05", brutoPeriodo: eur(800) });
  ok(futuro.paye > 0, "ano sem tabela continua a calcular");
  ok(temAviso(futuro, "aviso.tabelaHerdada"), "mas diz que herdou", codigos(futuro));

  const classeB = calcular({ ...BASE, base: "semana1", brutoPeriodo: eur(800), classePRSI: "B" });
  ok(temAviso(classeB, "aviso.classePrsi") && classeB.avisos.find((a) => a.codigo === "aviso.classePrsi").params.classe === "B",
     "classe nao implementada avisa, e diz QUAL", codigos(classeB));
}

console.log("\n== o quinzenal e o mensal ==");
{
  // A isencao do PRSI e SEMANAL: num mensal compara-se o ganho semanal medio.
  const mensal = calcular({
    ...BASE, base: "semana1", periodosNoAno: 12, periodoNo: 3, brutoPeriodo: eur(1400),
  });
  // 1.400/mes = 323/semana -> abaixo dos 352, nao paga PRSI de empregado.
  ok(mensal.prsiEmpregado === 0, "mensal baixo: a isencao semanal aplica-se",
     euros(mensal.prsiEmpregado));

  const quinzenal = calcular({
    ...BASE, base: "semana1", periodosNoAno: 26, periodoNo: 5, brutoPeriodo: eur(1600),
  });
  // 1.600/quinzena = 800/semana -> paga.
  ok(quinzenal.prsiEmpregado > 0, "quinzenal alto paga");
  ok(perto(quinzenal.prsiEmpregador, eur(1600 * 0.1125)), "e o empregador na taxa alta",
     euros(quinzenal.prsiEmpregador));
}

console.log("\n== o TECTO: nao se retem mais do que a pessoa ganhou ==");
{
  /*
   * Apanhado a correr a folha a serio, e nao aqui: alguem com acumulado de
   * abertura de 20.014 e PAYE retido de zero devia 1.695,21 numa semana de
   * 660,00, e o liquido saiu -1.401,44.
   *
   * Nenhum sistema entrega um numero negativo a uma pessoa. O que nao cabe
   * TRANSITA, e o cumulativo recolhe-o sozinho: o retido acumulado fica abaixo
   * do devido e a diferenca volta a aparecer no periodo seguinte.
   */
  const r = calcular({
    ...BASE, periodoNo: 30, brutoPeriodo: eur(660),
    acumuladoAnterior: { bruto: eur(19354.5), paye: 0, usc: 0, prsiEmpregado: eur(720.72) },
  });
  ok(r.liquido >= 0, "o liquido nunca e negativo", euros(r.liquido));
  /*
   * A AE conta para o tecto, e isto foi um defeito a serio: com ela descontada
   * DEPOIS, o tecto concluia que cabia tudo e o liquido saia a -9,90.
   */
  ok(r.paye + r.usc + r.prsiEmpregado + r.aeEmpregado <= r.brutoPeriodo,
     "as retencoes juntas, AE incluida, nao passam o bruto",
     [euros(r.paye + r.usc + r.prsiEmpregado + r.aeEmpregado), euros(r.brutoPeriodo)]);
  ok(temAviso(r, "aviso.naoCoube"), "e diz o que ficou por cobrar", codigos(r));

  // O PRSI e o primeiro e NUNCA se corta: nao e cumulativo, e paga seguro
  // social — cortar ali tirava direitos a pessoa.
  ok(r.prsiEmpregado > 0, "o PRSI e cobrado por inteiro", euros(r.prsiEmpregado));
  const naoCoube = r.avisos.find((a) => a.codigo === "aviso.naoCoube");
  ok(naoCoube && /^\d+\.\d{2}$/.test(String(naoCoube.params.v)),
     "e o valor vai JA FORMATADO nos parametros — o dicionario nao sabe se e dinheiro",
     naoCoube && naoCoube.params);

  // Uma DEVOLUCAO nao se corta: ela aumenta o liquido.
  const dev = calcular({
    ...BASE, periodoNo: 30, brutoPeriodo: eur(100),
    acumuladoAnterior: { bruto: eur(5000), paye: eur(900), usc: 0, prsiEmpregado: 0 },
  });
  ok(dev.paye < 0, "devolucao continua negativa", euros(dev.paye));
  ok(dev.liquido > dev.brutoPeriodo, "e faz o liquido passar o bruto, que e o que uma devolucao e",
     [euros(dev.liquido), euros(dev.brutoPeriodo)]);

  // Semana normal nao e tocada pelo tecto.
  const normal = calcular({
    ...BASE, periodoNo: 30, brutoPeriodo: eur(800),
    acumuladoAnterior: { bruto: eur(23200), paye: eur(2400), usc: eur(500), prsiEmpregado: eur(970) },
  });
  ok(!temAviso(normal, "aviso.naoCoube"), "semana normal nao aciona o tecto", codigos(normal));
}

console.log("\n== segurar a devolucao para o periodo seguinte ==");
{
  /*
   * Quem sai da base de emergencia recebe de volta o que la se reteve a mais —
   * as vezes centenas de euros numa semana. Esse dinheiro sai do bolso do
   * EMPREGADOR na hora (ele desconta depois no que remete a Revenue), e numa
   * semana de tesouraria apertada isso e um problema real.
   *
   * A decisao de segurar e de quem paga; o sistema so tem de a respeitar e
   * gravar. O valor nao se guarda: o cumulativo volta a apura-lo sozinho.
   */
  const entrada = {
    ...BASE, periodoNo: 30, brutoPeriodo: eur(600),
    acumuladoAnterior: { bruto: eur(17400), paye: eur(2500), usc: eur(300), prsiEmpregado: eur(730) },
  };
  const paga = calcular(entrada);
  ok(paga.paye < 0, "sem segurar, ha devolucao", euros(paga.paye));

  const segura = calcular({ ...entrada, segurarDevolucao: true });
  ok(segura.paye === 0, "segurando, o PAYE do periodo e zero", euros(segura.paye));
  ok(segura.devolucaoSegura === -paga.paye,
     "e a devolucao apurada fica registada, inteira",
     [euros(segura.devolucaoSegura), euros(-paga.paye)]);
  ok(segura.liquido < paga.liquido,
     "o liquido e menor: e o dinheiro que nao saiu esta semana",
     [euros(segura.liquido), euros(paga.liquido)]);
  ok(temAviso(segura, "aviso.devolucaoSegura"), "e diz-se que foi segurada", codigos(segura));

  /*
   * O QUE FAZ ISTO FUNCIONAR: o acumulado retido NAO baixa.
   *
   * E por isso que nao e preciso guardar o valor seguro em lado nenhum — o
   * periodo seguinte ve o retido ainda alto e volta a apurar a devolucao.
   */
  ok(segura.acumulado.paye === entrada.acumuladoAnterior.paye,
     "o retido acumulado nao baixa — e o que faz a devolucao voltar a aparecer",
     [euros(segura.acumulado.paye), euros(entrada.acumuladoAnterior.paye)]);

  const seguinte = calcular({
    ...BASE, periodoNo: 31, brutoPeriodo: eur(600),
    acumuladoAnterior: {
      bruto: segura.acumulado.bruto, paye: segura.acumulado.paye,
      usc: segura.acumulado.usc, prsiEmpregado: segura.acumulado.prsiEmpregado,
    },
  });
  ok(seguinte.paye < 0, "e no periodo seguinte ela volta, sozinha", euros(seguinte.paye));

  // Segurar quando NAO ha devolucao nao faz nada.
  const semDevolucao = calcular({
    ...BASE, base: "semana1", brutoPeriodo: eur(800), segurarDevolucao: true,
  });
  ok(semDevolucao.devolucaoSegura === 0 && semDevolucao.paye > 0,
     "segurar sem haver devolucao e um no-op");
}

console.log("\n== CONTRA UM PAYSLIP REAL DO SAGE (semana 35 de 2026) ==");
{
  /*
   * O teste mais valioso deste ficheiro: numeros de um payslip a serio, de um
   * sistema a serio, do ano corrente. Os testes acima provam que o motor faz o
   * que EU acho que a lei diz; este prova que faz o que o Sage faz.
   *
   * Sem nome nem PPS — so os numeros, que sao o que importa.
   *
   *   Bruto do periodo   653,85      Cumulativo bruto   22.241,26
   *   PAYE                53,84      Cumulativo PAYE     1.755,70
   *   USC                 10,63      Cumulativo USC        352,79
   *   PRSI empregado      27,46      Cumulativo PRSI       934,11
   *   PRSI patrao         73,56      STD.CUT OFF        29.615,60
   *   Base N (cumulativa) A1         TAX CREDIT          2.692,55
   *
   * TRES defeitos meus sairam daqui, e nenhum deles teria saido de mais testes
   * meus — porque eram enganos sobre a REGRA, e um teste meu repete o engano:
   *
   *   1. O arredondamento do cut-off e dos creditos: a conta obvia
   *      (anual x n / 52, arredondado no fim) dava 29.615,38 contra os
   *      29.615,60 do Sage. A regra e valor DO PERIODO arredondado para CIMA,
   *      vezes o numero do periodo. O 76,93 esta impresso no proprio payslip.
   *
   *   2. O tecto da banda de 2% do USC em 2026: 28.700 e nao os 27.382 de 2025.
   *
   *   3. A AE Pension (auto-enrolment) existe e o motor nao a tem. E a unica
   *      linha do payslip que ele ainda nao sabe fazer.
   */
  const eur2 = (v) => Math.round(v * 100);
  const r = calcular({
    brutoPeriodo: eur2(653.85), dataPagamento: "2026-09-02",
    periodosNoAno: 52, periodoNo: 35, base: "cumulativa", situacao: "solteiro",
    acumuladoAnterior: {
      bruto: eur2(22241.26 - 653.85), paye: eur2(1755.70 - 53.84),
      usc: eur2(352.79 - 10.63), prsiEmpregado: eur2(934.11 - 27.46),
    },
    aeInscrito: true,
  });
  const bate = (meu, sage, label) => ok(Math.abs(meu - eur2(sage)) <= 1, label,
    [euros(meu).toFixed(2), sage.toFixed(2)]);

  bate(r.aplicado.cutOffPeriodo, 29615.60, "STD.CUT OFF acumulado");
  bate(r.aplicado.creditosPeriodo, 2692.55, "TAX CREDIT acumulado");
  bate(r.paye, 53.84, "PAYE do periodo");
  bate(r.acumulado.paye, 1755.70, "TAX PAID acumulado");
  bate(r.usc, 10.63, "USC do periodo");
  bate(r.acumulado.usc, 352.79, "USC acumulado");
  bate(r.prsiEmpregado, 27.46, "PRSI do empregado");
  bate(r.prsiEmpregador, 73.56, "EMPER PRSI do periodo");

  /*
   * A AE PENSION — a ultima linha que faltava, e a que mais se erra.
   *
   * 9,81 sobre 653,85 e 1,5%, de cada lado. E ela NAO desgrava: repare-se que
   * o proprio payslip diz GROSS PAY 22.241,26 e TAXABLE PAY 22.241,26, iguais
   * ao centimo, com 333,66 de AE ja descontados no acumulado. Se desgravasse, a
   * base tributavel teria de ser MENOR.
   */
  bate(r.aeEmpregado, 9.81, "AE Pension do empregado (1,5%)");
  bate(r.aeEmpregador, 9.81, "AE Pension do empregador (1,5%)");
  bate(r.liquido, 552.11, "NETT PAY — o payslip inteiro fecha");
  // O imposto NAO muda por causa da AE: e a prova de que ela nao desgrava.
  bate(r.paye, 53.84, "e o PAYE continua o mesmo — a AE nao reduziu a base");
}

console.log("\n== o liquido fecha ==");
{
  const r = calcular({
    ...BASE, brutoPeriodo: eur(1000),
    acumuladoAnterior: { bruto: eur(9000), paye: eur(1000), usc: eur(200), prsiEmpregado: eur(378) },
  });
  ok(r.liquido === r.brutoPeriodo - r.paye - r.usc - r.prsiEmpregado - r.aeEmpregado,
     "liquido = bruto - PAYE - USC - PRSI - AE, ao centimo");
  ok(Number.isInteger(r.paye) && Number.isInteger(r.usc) && Number.isInteger(r.liquido),
     "e tudo sao centimos INTEIROS — sem dizima a acumular");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
