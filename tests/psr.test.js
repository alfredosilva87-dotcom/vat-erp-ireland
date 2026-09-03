/**
 * A submissao a Revenue (PSR) — teste.
 *
 * Duas coisas se provam aqui, e a primeira e a que menos parece importante:
 *
 *   1. as SEMANAS SEGURAVEIS. Nao mexem em imposto nenhum, entao ninguem as
 *      confere — e sao elas que decidem o subsidio de doenca, o de desemprego e
 *      a pensao. Um erro aqui aparece anos depois, a pessoa, quando ela precisa.
 *
 *   2. a CRITICA. O que impede o envio tem de estar separado do que so merece
 *      atencao, porque uma submissao rejeitada corrige-se e uma submissao
 *      ACEITE com um numero errado nao da sinal nenhum.
 */
const {
  semanasSeguraveis, criticarLinha, diasDeAtraso, totaisDaSubmissao,
} = require("../.test-build/hr/psrPuro");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const bloqueios = (rs) => rs.filter((r) => r.bloqueia).map((r) => r.codigo);
const avisos = (rs) => rs.filter((r) => !r.bloqueia).map((r) => r.codigo);

console.log("\n== semanas seguraveis ==");
{
  ok(semanasSeguraveis({
    freq: "weekly", semanasDoPeriodo: [35], semanasComTrabalho: [35], brutoCents: 65385,
  }) === 1, "uma semana trabalhada da uma semana");

  ok(semanasSeguraveis({
    freq: "fortnightly", semanasDoPeriodo: [17, 18], semanasComTrabalho: [17, 18], brutoCents: 130000,
  }) === 2, "a quinzena da duas");

  /*
   * O MES DE CINCO SEMANAS.
   *
   * Escrever "mensal = 4" e o atalho errado: ha meses de cinco semanas ISO, e
   * quem usa 4 sempre deixa a pessoa com doze semanas a menos ao fim de um ano.
   */
  ok(semanasSeguraveis({
    freq: "monthly", semanasDoPeriodo: [31, 32, 33, 34, 35],
    semanasComTrabalho: [31, 32, 33, 34, 35], brutoCents: 400000,
  }) === 5, "um mes de cinco semanas da CINCO, e nao quatro");

  ok(semanasSeguraveis({
    freq: "monthly", semanasDoPeriodo: [27, 28, 29, 30],
    semanasComTrabalho: [27, 28, 29, 30], brutoCents: 400000,
  }) === 4, "e um de quatro da quatro");
}

console.log("\n== quem entra ou sai a meio ==");
{
  ok(semanasSeguraveis({
    freq: "monthly", semanasDoPeriodo: [31, 32, 33, 34],
    semanasComTrabalho: [33, 34], brutoCents: 200000,
  }) === 2, "quem so trabalhou duas das quatro leva duas");

  // Semanas de OUTRO periodo nao contam, mesmo que a pessoa as tenha
  // trabalhado: cada submissao comunica o seu periodo.
  ok(semanasSeguraveis({
    freq: "weekly", semanasDoPeriodo: [35], semanasComTrabalho: [30, 31, 35], brutoCents: 65385,
  }) === 1, "so contam as semanas DESTE periodo");
}

console.log("\n== os casos que dao numero errado sem dar erro ==");
{
  ok(semanasSeguraveis({
    freq: "weekly", semanasDoPeriodo: [35], semanasComTrabalho: [], brutoCents: 0,
  }) === 0, "sem pagamento nenhum, zero semanas");

  /*
   * Valor lancado a mao: houve pagamento e o livro de horas nao tem nada
   * marcado. Devolver zero dizia a Revenue que a pessoa recebeu sem estar
   * empregada — e e a semana seguravel dela que se perdia.
   */
  ok(semanasSeguraveis({
    freq: "weekly", semanasDoPeriodo: [35], semanasComTrabalho: [], brutoCents: 90000,
  }) === 1, "houve pagamento e nenhuma semana marcada: conta o periodo inteiro");

  ok(semanasSeguraveis({
    freq: "monthly", semanasDoPeriodo: [31, 32, 33, 34, 35],
    semanasComTrabalho: [], brutoCents: 400000,
  }) === 5, "e no mensal conta as cinco, nao uma");

  // Nunca mais do que o periodo cobre, aconteca o que acontecer no livro.
  ok(semanasSeguraveis({
    freq: "weekly", semanasDoPeriodo: [35], semanasComTrabalho: [35, 35], brutoCents: 65385,
  }) === 1, "nunca passa do que o periodo cobre");
}

console.log("\n== o que impede o envio ==");
{
  const boa = {
    employeeId: "1", nome: "Ana Silva", pps: "1234567FA", employmentId: "1",
    dataPagamento: "2026-09-02", freq: "weekly",
    brutoCents: 65385, tributavelCents: 65385, payeCents: 5034, uscCents: 1009,
    prsiEmpregadoCents: 2615, prsiEmpregadorCents: 7192,
    classePRSI: "A1", semanasSeguraveis: 1, aeEmpregadoCents: 981, aeEmpregadorCents: 981,
  };

  ok(!criticarLinha(boa).length, "uma linha completa nao tem reparo nenhum", criticarLinha(boa));

  ok(bloqueios(criticarLinha({ ...boa, pps: null })).includes("psr.semPps"),
     "sem PPS bloqueia");

  /*
   * Um PPS com digito de controlo errado e PIOR do que um em falta: em falta a
   * Revenue recusa, errado ela pode aceitar contra outra pessoa.
   */
  ok(bloqueios(criticarLinha({ ...boa, pps: "1234567A" })).includes("psr.ppsInvalido"),
     "PPS com digito errado bloqueia, e nao passa por valido");

  ok(bloqueios(criticarLinha({ ...boa, employmentId: null })).includes("psr.semEmploymentId"),
     "sem employment ID bloqueia — ele identifica o vinculo, nao a pessoa");

  ok(bloqueios(criticarLinha({ ...boa, classePRSI: null })).includes("psr.semClassePrsi"),
     "sem classe de PRSI bloqueia");

  ok(bloqueios(criticarLinha({ ...boa, semanasSeguraveis: 0 })).includes("psr.semSemanas"),
     "pagamento com zero semanas seguraveis bloqueia");

  ok(bloqueios(criticarLinha({ ...boa, tributavelCents: 70000 })).includes("psr.tributavelMaior"),
     "tributavel acima do bruto bloqueia");
}

console.log("\n== o que so merece atencao ==");
{
  const boa = {
    employeeId: "1", nome: "Ana", pps: "1234567FA", employmentId: "1",
    dataPagamento: "2026-09-02", freq: "weekly",
    brutoCents: 65385, tributavelCents: 65385, payeCents: 5034, uscCents: 1009,
    prsiEmpregadoCents: 2615, prsiEmpregadorCents: 7192,
    classePRSI: "A1", semanasSeguraveis: 1, aeEmpregadoCents: 0, aeEmpregadorCents: 0,
  };

  /*
   * Devolucao de PAYE e o feitio da base cumulativa, nao um defeito — e e a
   * linha que mais da vontade de "corrigir" a quem nao conhece a regra.
   */
  const dev = criticarLinha({ ...boa, payeCents: -12000 });
  ok(avisos(dev).includes("psr.payeDevolvido"), "PAYE negativo avisa");
  ok(!bloqueios(dev).length, "mas NAO bloqueia: e assim que a base cumulativa funciona");

  const zero = criticarLinha({ ...boa, brutoCents: 0, tributavelCents: 0, semanasSeguraveis: 0 });
  ok(avisos(zero).includes("psr.brutoZero"), "bruto zero avisa");
  ok(!bloqueios(zero).length,
     "e nao bloqueia: licenca sem vencimento comunica-se a zero", bloqueios(zero));
}

console.log("\n== o prazo ==");
{
  // Desde 2019 comunica-se NO DIA do pagamento ou antes. Nao ha prazo no mes
  // seguinte, e e isso que apanha quem vem de um sistema antigo.
  ok(diasDeAtraso("2026-09-02", "2026-09-02") === 0, "no proprio dia nao ha atraso");
  ok(diasDeAtraso("2026-09-02", "2026-09-05") === 3, "tres dias depois, tres dias de atraso");
  ok(diasDeAtraso("2026-09-10", "2026-09-02") === 0, "comunicar ANTES nao e atraso negativo");
}

console.log("\n== o que se paga a Revenue ==");
{
  const l = (o) => ({
    employeeId: "x", nome: "x", pps: null, employmentId: null,
    dataPagamento: "2026-09-02", freq: "weekly", tributavelCents: 0,
    brutoCents: 0, payeCents: 0, uscCents: 0,
    prsiEmpregadoCents: 0, prsiEmpregadorCents: 0,
    classePRSI: "A1", semanasSeguraveis: 1, aeEmpregadoCents: 0, aeEmpregadorCents: 0, ...o,
  });
  const t = totaisDaSubmissao([
    l({ brutoCents: 65385, payeCents: 5034, uscCents: 1009, prsiEmpregadoCents: 2615, prsiEmpregadorCents: 7192 }),
    l({ brutoCents: 50000, payeCents: 3000, uscCents: 800, prsiEmpregadoCents: 2000, prsiEmpregadorCents: 5500 }),
  ]);

  ok(t.pessoas === 2, "conta as pessoas");
  ok(t.semanas === 2, "e as semanas seguraveis");
  /*
   * O erro classico: somar so o que se descontou ao empregado. A parte do
   * EMPREGADOR tambem se paga, e esquece-la faz a conta do mes vir maior do que
   * o escritorio provisionou, sem se perceber de onde saiu a diferenca.
   */
  ok(t.aPagar === 5034 + 1009 + 2615 + 7192 + 3000 + 800 + 2000 + 5500,
     "o que se paga inclui as DUAS partes do PRSI", t.aPagar);
  ok(t.aPagar > t.paye + t.usc + t.prsiEe,
     "e e maior do que so o que se descontou ao empregado");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
