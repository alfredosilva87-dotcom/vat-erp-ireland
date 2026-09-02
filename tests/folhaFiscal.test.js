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
const eur = (v) => Math.round(v * 100);

const BASE = {
  dataPagamento: "2026-03-05", periodosNoAno: 52, periodoNo: 10,
  base: "cumulativa", situacao: "solteiro",
};

console.log("\n== a base cumulativa: imposto sobre o ANO, menos o ja retido ==");
{
  // Solteiro, EUR 800/semana. Cut-off 44.000/ano, creditos 4.000/ano.
  // Na semana 10: cut-off 8.461,54 · creditos 769,23 · bruto acumulado 8.000.
  // Tudo abaixo do cut-off -> 20% de 8.000 = 1.600; menos 769,23 = 830,77 devido.
  // Ja retido 747,69 (as 9 semanas anteriores) -> a semana paga 83,08.
  const r = calcular({
    ...BASE, brutoPeriodo: eur(800),
    acumuladoAnterior: { bruto: eur(7200), paye: eur(747.69), usc: 0, prsiEmpregado: 0 },
  });
  ok(perto(r.aplicado.cutOffPeriodo, eur(44000 * 10 / 52)), "cut-off rateado por 10/52",
     euros(r.aplicado.cutOffPeriodo));
  ok(perto(r.aplicado.creditosPeriodo, eur(4000 * 10 / 52)), "creditos rateados por 10/52",
     euros(r.aplicado.creditosPeriodo));
  ok(perto(r.paye, eur(83.08)), "PAYE da semana = devido no acumulado - ja retido", euros(r.paye));

  // A mesma pessoa em Week 1 basis: a semana vive sozinha.
  const w1 = calcular({ ...BASE, base: "semana1", brutoPeriodo: eur(800) });
  // cut-off 44.000/52 = 846,15 -> 800 todo a 20% = 160; creditos 4.000/52 = 76,92
  ok(perto(w1.paye, eur(83.08)), "Week 1 da o mesmo quando o salario e constante", euros(w1.paye));
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

  // As bandas: 0,5% ate 12.012 · 2% ate 27.382 · 3% ate 70.044 · 8% acima.
  const em30k = uscSobre(eur(30000), tabela.usc, 52, 52, false);
  const esperado = eur(12012 * 0.005 + (27382 - 12012) * 0.02 + (30000 - 27382) * 0.03);
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

  ok(alto.custoEmpregador === alto.brutoPeriodo + alto.prsiEmpregador,
     "custo do empregador = bruto + PRSI dele");
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
  ok(emerg.avisos.some((a) => /RPN/.test(a)), "e o aviso diz para pedir o RPN");

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
  ok(!daRevenue.avisos.some((a) => /Sem RPN/.test(a)), "e o aviso de 'sem RPN' desaparece");
  ok(doCadastro.avisos.some((a) => /Sem RPN/.test(a)), "sem ele, o aviso aparece");
}

console.log("\n== os avisos, que impedem um numero por confirmar de passar por confirmado ==");
{
  const r = calcular({ ...BASE, base: "semana1", brutoPeriodo: eur(800) });
  ok(r.avisos.some((a) => /NAO foi conferida/.test(a)),
     "a tabela por confirmar diz-se por confirmar", r.avisos);

  // Ano sem tabela: usa a mais proxima E avisa. Nao rebenta — uma folha que nao
  // corre por falta de tabela e um escritorio parado.
  const futuro = calcular({ ...BASE, base: "semana1", dataPagamento: "2031-03-05", brutoPeriodo: eur(800) });
  ok(futuro.paye > 0, "ano sem tabela continua a calcular");
  ok(futuro.avisos.some((a) => /Nao ha tabela fiscal/.test(a)), "mas diz que herdou", futuro.avisos);

  const classeB = calcular({ ...BASE, base: "semana1", brutoPeriodo: eur(800), classePRSI: "B" });
  ok(classeB.avisos.some((a) => /Classe de PRSI B/.test(a)), "classe nao implementada avisa");
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

console.log("\n== o liquido fecha ==");
{
  const r = calcular({
    ...BASE, brutoPeriodo: eur(1000),
    acumuladoAnterior: { bruto: eur(9000), paye: eur(1000), usc: eur(200), prsiEmpregado: eur(378) },
  });
  ok(r.liquido === r.brutoPeriodo - r.paye - r.usc - r.prsiEmpregado,
     "liquido = bruto - PAYE - USC - PRSI, ao centimo");
  ok(Number.isInteger(r.paye) && Number.isInteger(r.usc) && Number.isInteger(r.liquido),
     "e tudo sao centimos INTEIROS — sem dizima a acumular");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
