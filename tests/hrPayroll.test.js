/**
 * Os calculos da folha (modulo RH) — testes.
 *
 * Roda com `npm test`, que compila lib/hr/payroll.ts antes.
 *
 * Este arquivo e uma TRADUCAO do sistema do Matheus, e traducao erra em
 * silencio: o codigo compila, a tela desenha, os numeros saem plausiveis e
 * estao errados por 0,3%. Ninguem confere um payslip com regua. Por isso os
 * testes abaixo nao se contentam em ver se "roda" — recuperam os valores que a
 * lei irlandesa manda, e comparam numero a numero com o que o sistema dele
 * produz.
 *
 * Os tres que mais custaram a existir, e que voltariam se alguem "simplificar":
 *
 *   1. `20 / 52` por dividir. Escrever 0.3846 fecha o ano em 19,9992 dias.
 *   2. A media do bank holiday dividida pelas semanas COM trabalho, nao por 5.
 *   3. O contrato fixo passa a semana ANTES de dividir por 5.
 */
const P = require("../.test-build/hr/payroll.js");

let pass = 0, fail = 0;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
const iso = (d) => d.toISOString().slice(0, 10);

console.log("\n== bruto: pago a hora ==");
{
  const e = { id: "1", pay_type: "Hourly", hourly_rate: 13.5, sunday_rate: 18 };
  ok(P.grossFor(e, { hours: 40 }) === 540, "40h x 13,50 = 540");
  ok(P.grossFor(e, { hours: 40, sunday_hours: 6 }) === 648, "domingo entra a taxa propria", P.grossFor(e, { hours: 40, sunday_hours: 6 }));
  // Sem taxa de domingo cadastrada, o domingo paga a taxa normal — nao zero.
  const semDom = { id: "2", pay_type: "Hourly", hourly_rate: 10, sunday_rate: 0 };
  ok(P.grossFor(semDom, { hours: 10, sunday_hours: 5 }) === 150, "sem taxa de domingo usa a normal");
  ok(P.grossFor(e, null) === 0, "semana sem lancamento paga zero");
}

console.log("\n== bruto: contrato fixo ==");
{
  const q = { id: "3", pay_type: "Fortnightly Fixed", fixed_amount: 650 };
  ok(P.grossFor(q, { week_worked: true }) === 325, "quinzena reparte por 2");
  ok(P.grossFor(q, { week_worked: false }) === 0, "semana nao marcada nao paga");
  ok(P.grossFor(q, {}) === 0, "sem a marca tambem nao paga");
  const m = { id: "4", pay_type: "Monthly Fixed", fixed_amount: 2600 };
  ok(near(P.grossFor(m, { week_worked: true }), 2600 / 4.333, 1e-9), "mes reparte por 4,333", P.grossFor(m, { week_worked: true }));
  const s = { id: "5", pay_type: "Weekly Fixed", fixed_amount: 500 };
  ok(P.grossFor(s, { week_worked: true }) === 500, "semanal paga o valor inteiro");
  // Um periodo completo tem de fechar EXATAMENTE no contrato.
  ok(near(P.grossFor(q, { week_worked: true }) * 2, 650, 1e-9), "duas semanas fecham a quinzena no valor exato");
}

console.log("\n== bruto: o lancado a mao manda ==");
{
  const e = { id: "6", pay_type: "Hourly", hourly_rate: 13.5 };
  ok(P.grossFor(e, { hours: 40, gross_override: 600 }) === 600, "override substitui o calculo");
  // O caso que um `||` mal escrito quebra: override ZERO e uma decisao, nao ausencia.
  ok(P.grossFor(e, { hours: 40, gross_override: 0 }) === 0, "override zero vale zero, nao 540");
  const fixo = { id: "7", pay_type: "Monthly Fixed", fixed_amount: 2600 };
  ok(P.grossFor(fixo, { week_worked: false, gross_override: 100 }) === 100, "override manda tambem no contrato fixo");
}

console.log("\n== ferias: a divisao por fazer ==");
{
  const h = { id: "8", pay_type: "Hourly" };
  ok(near(P.holidayFor(h, 100, 0), 8), "pago a hora acumula 8% das horas");
  const f = { id: "9", pay_type: "Weekly Fixed" };
  // ESTE e o teste que pega 0.3846 escrito a mao.
  ok(near(P.holidayFor(f, 0, 52), 20, 1e-9), "52 semanas fecham EXATAMENTE 20 dias", P.holidayFor(f, 0, 52));
  ok(!near(P.holidayFor(f, 0, 52), 19.9992, 1e-9), "e nao 19,9992, que e o que 0.3846 daria");
  ok(P.holidayUnit(h) === "hours" && P.holidayUnit(f) === "days", "a unidade acompanha o tipo de pagamento");
  ok(near(P.holidayBalance({ holiday_opening: 2 }, 6.54, 1.23), 7.31, 1e-9), "saldo = inicial + acumulado - usado");
}

console.log("\n== Pascoa: computus ==");
{
  const casos = [[2024, "2024-03-31"], [2025, "2025-04-20"], [2026, "2026-04-05"],
    [2027, "2027-03-28"], [2030, "2030-04-21"]];
  for (const [y, esperado] of casos)
    ok(iso(P.easterSunday(y)) === esperado, `Pascoa de ${y} = ${esperado}`, iso(P.easterSunday(y)));
}

console.log("\n== os dez feriados irlandeses ==");
{
  const bh = P.bankHolidaysOf(2026);
  ok(bh.length === 10, "sao dez", bh.length);
  const by = {}; bh.forEach((b) => { by[b.key] = b; });
  ok(iso(by["new-year"].date) === "2026-01-01", "ano novo");
  ok(iso(by["patrick"].date) === "2026-03-17", "St Patrick e data fixa");
  // Pascoa 2026 = 5 abril, logo Easter Monday = 6 abril.
  ok(iso(by["easter"].date) === "2026-04-06", "Easter Monday e o dia seguinte a Pascoa", iso(by["easter"].date));
  ok(iso(by["christmas"].date) === "2026-12-25" && iso(by["stephen"].date) === "2026-12-26", "Natal e St Stephen");

  // October: ULTIMA segunda, nao a primeira.
  const out = by["october"].date;
  ok(out.getUTCDay() === 1 && out.getUTCMonth() === 9, "October cai numa segunda de outubro");
  const maisSete = new Date(out); maisSete.setUTCDate(out.getUTCDate() + 7);
  ok(maisSete.getUTCMonth() !== 9, "e e a ULTIMA segunda do mes", iso(out));

  // May/June/August: PRIMEIRA segunda.
  for (const k of ["may", "june", "august"]) {
    const d = by[k].date;
    ok(d.getUTCDay() === 1 && d.getUTCDate() <= 7, `${k} e a primeira segunda`, iso(d));
  }
}

console.log("\n== St Brigid: a regra da sexta-feira ==");
{
  // A regra so se ve num ano em que 1 de fevereiro cai numa sexta. Em vez de
  // fixar o ano, procura-se um — assim o teste continua valido no futuro.
  let sexta = null, outro = null;
  for (let y = 2024; y <= 2060 && (!sexta || !outro); y++) {
    const feb1 = new Date(Date.UTC(y, 1, 1));
    if (feb1.getUTCDay() === 5 && !sexta) sexta = y;
    if (feb1.getUTCDay() !== 5 && !outro) outro = y;
  }
  const bA = P.bankHolidaysOf(sexta).find((b) => b.key === "brigid");
  ok(iso(bA.date) === `${sexta}-02-01`, `${sexta}: 1 de fevereiro e sexta, entao o feriado E o dia 1`, iso(bA.date));
  const bB = P.bankHolidaysOf(outro).find((b) => b.key === "brigid");
  ok(bB.date.getUTCDay() === 1 && bB.date.getUTCDate() <= 7,
     `${outro}: nos outros anos e a primeira segunda`, iso(bB.date));
}

console.log("\n== bank holiday: pago a hora ==");
{
  // 4 semanas com trabalho de 40h, 1 semana vazia, dentro da janela S29-S33.
  const horas = { 29: { hours: 40 }, 30: { hours: 40 }, 31: { hours: 40 }, 32: { hours: 40 }, 33: null };
  const get = (_id, w) => horas[w];
  const casual = { id: "a", pay_type: "Hourly", hourly_rate: 10, contract_type: "Casual" };
  const r = P.bankHolidayFor(casual, 34, get);

  ok(r.de === 29 && r.ate === 33, "a janela sao as 5 semanas ANTERIORES", [r.de, r.ate]);
  ok(r.total === 160 && r.semanas === 4, "so as semanas com trabalho entram", [r.total, r.semanas]);
  // O CERNE: 160/4 = 40, nao 160/5 = 32.
  ok(r.media === 40, "media divide pelas semanas COM trabalho, nao por 5", r.media);
  ok(r.pagar === 8, "paga um quinto da semana normal (40/5)", r.pagar);
  ok(r.pagarEuros === 80, "e em euros a taxa da pessoa", r.pagarEuros);
  ok(r.elegivel === true, "160h passa o minimo de 40");
}

console.log("\n== bank holiday: quem e casual tem de provar as 40 horas ==");
{
  const magro = { 30: { hours: 10 }, 31: { hours: 10 } };
  const get = (_id, w) => magro[w];
  const casual = { id: "b", pay_type: "Hourly", hourly_rate: 10, contract_type: "Casual" };
  const r = P.bankHolidayFor(casual, 34, get);
  ok(r.total === 20 && r.elegivel === false, "20h nao chega: casual fica sem direito", [r.total, r.elegivel]);
  ok(r.pagar === 0 && r.pagarEuros === 0, "e por isso nao se paga nada");
  // A media continua a ser calculada — e o que diz quantas horas pagar SE tivesse direito.
  ok(r.media === 10, "a media e calculada na mesma", r.media);

  // Full time com as mesmas 20 horas: TEM direito, sem provar nada.
  const full = { id: "c", pay_type: "Hourly", hourly_rate: 10, contract_type: "Full time" };
  const rf = P.bankHolidayFor(full, 34, get);
  ok(rf.elegivel === true && rf.pagar === 2, "full time entra pela porta da frente, com as mesmas 20h", [rf.elegivel, rf.pagar]);
}

console.log("\n== bank holiday: ferias contam como tempo trabalhado ==");
{
  // Uma semana so de ferias nao pode fazer a pessoa perder o feriado.
  const so = { 33: { hours: 0, sunday_hours: 0, holiday_hours: 40 } };
  const get = (_id, w) => so[w];
  const casual = { id: "d", pay_type: "Hourly", hourly_rate: 10, contract_type: "Casual" };
  const r = P.bankHolidayFor(casual, 34, get);
  ok(r.total === 40 && r.semanas === 1, "as horas de ferias entram no total E no divisor", [r.total, r.semanas]);
  ok(r.elegivel === true, "e por isso a pessoa mantem o direito");
}

console.log("\n== bank holiday: contrato fixo ==");
{
  const get = (_id, w) => (w >= 30 ? { week_worked: true } : null);
  const m = { id: "e", pay_type: "Monthly Fixed", fixed_amount: 2600 };
  const r = P.bankHolidayFor(m, 34, get);
  ok(r.automatico === true && r.elegivel === true, "contrato fixo tem direito automatico");
  ok(near(r.porSemana, 2600 / 4.333, 1e-9), "passa primeiro a semana", r.porSemana);
  // O erro que este teste existe para pegar: 2600/5 = 520, que nao e um dia de ninguem.
  ok(near(r.pagarEuros, (2600 / 4.333) / 5, 1e-9), "e SO depois divide por 5", r.pagarEuros);
  ok(!near(r.pagarEuros, 520, 1e-6), "nunca o contrato inteiro dividido por 5");
  ok(r.semanas === 4, "conta as semanas marcadas, so para a tela responder", r.semanas);
}

console.log("\n== o que vence em cada semana ==");
{
  const hoje = { year: 2026, week: 1 };
  const semanal = { freq_weekly: true, payroll_config: [{ freq_type: "weekly", tracked_year: 2026, tracked_week: 1, issue_day: "Monday" }] };
  ok(P.dueInWeek(semanal, 2026, 10, hoje).length === 1, "o semanal sai toda semana");
  ok(P.dueInWeek(semanal, 2026, 10, hoje)[0].day === "Monday", "no dia da empresa");
  ok(P.dueInWeek(semanal, 2026, 10, hoje)[0].ownWeek === 10, "e diz a semana propria da empresa");

  const quinzenal = { freq_fortnightly: true, payroll_config: [{ freq_type: "fortnightly", tracked_year: 2026, tracked_week: 1 }] };
  const saiEm = [];
  for (let w = 1; w <= 12; w++) if (P.dueInWeek(quinzenal, 2026, w, hoje).length) saiEm.push(w);
  ok(JSON.stringify(saiEm) === JSON.stringify([3, 5, 7, 9, 11]),
     "o quinzenal so nas impares a partir da 3 (o periodo 1 cobre S1+S2 e sai na S3)", saiEm);
  // E o periodo diz QUAIS semanas cobre — e o par tem de casar com o numero.
  const p1 = P.dueInWeek(quinzenal, 2026, 3, hoje)[0];
  ok(p1.period === 1 && JSON.stringify(p1.periodWeeks) === JSON.stringify([1, 2]),
     "o periodo 1 cobre as semanas 1 e 2", p1);
  const p2 = P.dueInWeek(quinzenal, 2026, 5, hoje)[0];
  ok(p2.period === 2 && JSON.stringify(p2.periodWeeks) === JSON.stringify([3, 4]),
     "o periodo 2 cobre as semanas 3 e 4", p2);

  // Nada de texto pronto: a tela e que escreve, senao o ingles vaza para uma
  // tela em portugues — foi o que aconteceu na primeira versao.
  ok(p1.pos === undefined && p1.covers === undefined && p1.label === undefined,
     "dueInWeek devolve numeros, nunca frase montada");

  const mensal = { freq_monthly: true, payroll_config: [{ freq_type: "monthly", tracked_year: 2026, tracked_week: 1 }] };
  const dez = P.dueInWeek(mensal, 2026, 53, hoje);
  if (dez.length) ok(dez[0].month === 11, "a ultima quinta de dezembro e o mes 11 (0-based)", dez[0]);
  let meses = 0;
  // Ate 53: em 2026 a ultima quinta de dezembro cai na semana 53, e parar na 52
  // perdia dezembro inteiro.
  for (let w = 1; w <= P.isoWeeksInYear(2026); w++) if (P.dueInWeek(mensal, 2026, w, hoje).length) meses++;
  ok(meses === 12, "o mensal sai doze vezes no ano — uma por ultima quinta", meses);
}

console.log("\n== a empresa que anda atras do calendario ==");
{
  const hoje = { year: 2026, week: 1 };
  const c = { freq_weekly: true, payroll_config: [{ freq_type: "weekly", week_offset: 2, tracked_year: 2026, tracked_week: 1 }] };
  ok(P.dueInWeek(c, 2026, 5, hoje)[0].ownWeek === 3, "semana 5 do calendario e a semana 3 dela", P.dueInWeek(c, 2026, 5, hoje)[0]);
  ok(P.dueInWeek(c, 2026, 2, hoje).length === 0, "e antes disso ela ainda nao comecou");
}

console.log("\n== marcar como mensal hoje nao inventa doze meses de divida ==");
{
  const hoje = { year: 2026, week: 34 };
  const c = { freq_monthly: true, payroll_config: [{ freq_type: "monthly", tracked_year: 2026, tracked_week: 30 }] };
  let antes = 0;
  for (let w = 1; w < 30; w++) antes += P.dueInWeek(c, 2026, w, hoje).length;
  ok(antes === 0, "nada devido antes da semana em que o tipo entrou", antes);
  let depois = 0;
  for (let w = 30; w <= 52; w++) depois += P.dueInWeek(c, 2026, w, hoje).length;
  ok(depois > 0, "e devido dali em diante", depois);

  // Tipo sem bloco de configuracao: nasceu agora, conta desta semana.
  const novo = { freq_weekly: true, payroll_config: [] };
  ok(P.dueInWeek(novo, 2026, 33, hoje).length === 0, "sem config, semana anterior a atual nao e divida");
  ok(P.dueInWeek(novo, 2026, 34, hoje).length === 1, "e a semana atual ja conta");
  // Ano anterior ao rastreado: nao comecou.
  const futuro = { freq_weekly: true, payroll_config: [{ freq_type: "weekly", tracked_year: 2027, tracked_week: 1 }] };
  ok(P.dueInWeek(futuro, 2026, 40, hoje).length === 0, "tipo que so comeca no ano seguinte nao deve nada agora");
  // Ano posterior ao rastreado: conta o ano todo.
  const velho = { freq_weekly: true, payroll_config: [{ freq_type: "weekly", tracked_year: 2025, tracked_week: 40 }] };
  ok(P.dueInWeek(velho, 2026, 1, hoje).length === 1, "vindo de um ano anterior, conta desde a semana 1");
}

console.log("\n== os quatro estados ==");
{
  ok(P.SETTLED("done") && P.SETTLED("skip"), "'done' e 'skip' fecham a semana");
  ok(!P.SETTLED("na") && !P.SETTLED("pending"), "'na' e 'pending' nao fecham");

  const feito = { weeks: { 5: { weekly: { payslip: "done", er: "done", ee: "skip", ros: "done" } } } };
  ok(P.typeSettled(feito, 5, "weekly"), "'n/a' num item nao impede a semana de fechar");
  const soRos = { weeks: { 5: { weekly: { payslip: "done", er: "done", ee: "done", ros: "pending" } } } };
  ok(P.typeOnlyRos(soRos, 5, "weekly"), "so falta ROS");
  ok(!P.typeOnlyRos(feito, 5, "weekly"), "quem fechou tudo nao esta 'so falta ROS'");
  // Semana nunca tocada le como quatro tracos, e nao rebenta.
  ok(JSON.stringify(P.cellOf({}, 9, "weekly")) === JSON.stringify(P.BLANK_WEEK), "semana intocada le em branco");
}

console.log("\n== o atraso ==");
{
  const hoje = { year: 2026, week: 1 };
  const c = {
    freq_weekly: true,
    payroll_config: [{ freq_type: "weekly", tracked_year: 2026, tracked_week: 1 }],
    weeks: {
      1: { weekly: { payslip: "done", er: "done", ee: "done", ros: "done" } },
      2: { weekly: { payslip: "done", er: "done", ee: "done", ros: "pending" } },
      // a 3 nunca foi tocada: ja passou, logo o traco vale como divida
    },
  };
  const b = P.backlogWeeks(c, 2026, 5, hoje);
  ok(b.length === 3, "a 2 (ROS aberto), a 3 e a 4 (intocadas) estao em atraso", b.map((x) => x.week));
  ok(!b.some((x) => x.week === 1), "a semana fechada nao entra");
  ok(JSON.stringify(b.find((x) => x.week === 2).open) === JSON.stringify(["ros"]), "e diz o que falta em cada uma");
}

console.log("\n== semanas ISO ==");
{
  // A regra ISO: 53 semanas sse 1 de janeiro e quinta, ou bissexto com 1 na
  // quarta. O original respondia 53 para quase todo ano — ver o comentario em
  // isoWeeksInYear. Estes cinco sao exatamente os que ele errava.
  const esperado = { 2020: 53, 2021: 52, 2022: 52, 2023: 52, 2024: 52,
                     2025: 52, 2026: 53, 2027: 52, 2028: 52, 2032: 53 };
  for (const y of Object.keys(esperado))
    ok(P.isoWeeksInYear(Number(y)) === esperado[y], `${y} tem ${esperado[y]} semanas ISO`, P.isoWeeksInYear(Number(y)));
  ok(iso(P.isoWeekStart(2026, 1)) === "2025-12-29", "a semana 1 de 2026 comeca em 29/12/2025", iso(P.isoWeekStart(2026, 1)));
  ok(P.isoWeekDay(2026, 34, 1).getUTCDay() === 1, "dow 1 e segunda");
  ok(P.isoWeekDay(2026, 34, 7).getUTCDay() === 0, "dow 7 e domingo");
  // A semana pertence ao mes da sua quinta-feira.
  ok(P.monthOfWeek(2026, 1) === 0, "a semana 1 de 2026 e de janeiro, pela quinta-feira dela");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail === 0 ? 0 : 1);
