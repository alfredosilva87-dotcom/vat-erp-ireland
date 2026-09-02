/**
 * O RECIBO — teste.
 *
 * O que se prova aqui e uma coisa so, repetida de varios angulos: **as linhas
 * do recibo fecham sempre com o bruto**.
 *
 * Nao e zelo. O bruto vem do motor, que sabe de override, de contrato fixo
 * rateado e de arredondamento; a decomposicao em linhas e apresentacao. Se as
 * duas discordarem, quem recebe o papel nao consegue conferir e quem o emitiu
 * nao consegue explicar — e o erro nao da sinal nenhum, porque os dois numeros
 * parecem bons cada um por si.
 */
const {
  linhasDePagamento, nomeDoPayslip, rotuloDoPeriodo, cents,
} = require("../.test-build/hr/payslipPuro");
const { grossFor } = require("../.test-build/hr/payroll");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const soma = (linhas) => linhas.reduce((s, l) => s + l.valorCents, 0);

// ---------------------------------------------------------------- por hora
console.log("\nPago a hora");
{
  const emp = { id: "1", pay_type: "Hourly", hourly_rate: 16.35, sunday_rate: 20 };
  const horas = [{ hours: 40, sunday_hours: 0 }];
  const bruto = cents(grossFor(emp, horas[0]));
  const l = linhasDePagamento(emp, horas, bruto, true);

  ok(l.length === 1, "40h a taxa unica dao uma linha so", l.map((x) => x.chave));
  ok(l[0].chave === "payslip.pay_basic", "e a linha e a das horas normais");
  ok(l[0].horas === 40 && l[0].taxaCents === 1635, "com as horas e a taxa a vista");
  ok(soma(l) === bruto, "e fecham com o bruto", { soma: soma(l), bruto });
}

console.log("\nDomingo a taxa propria");
{
  const emp = { id: "1", pay_type: "Hourly", hourly_rate: 16.35, sunday_rate: 20 };
  const horas = [{ hours: 32, sunday_hours: 8 }];
  const bruto = cents(grossFor(emp, horas[0]));
  const l = linhasDePagamento(emp, horas, bruto, true);

  ok(l.length === 2, "duas linhas: normais e domingo");
  ok(l[1].taxaCents === 2000, "e o domingo sai a 20,00, nao a 16,35");
  ok(soma(l) === bruto, "e fecham com o bruto", { soma: soma(l), bruto });
}

console.log("\nHoras que nao dao um centimo redondo");
{
  /*
   * 38,5 x 16,35 = 629,475. O motor arredonda para 629,48 (ou 629,47), e a
   * conta da linha nao tem de cair no mesmo lado — e por isso e que o recibo
   * reconcilia em vez de confiar na multiplicacao.
   */
  const emp = { id: "1", pay_type: "Hourly", hourly_rate: 16.35 };
  const horas = [{ hours: 38.5, sunday_hours: 0 }];
  const bruto = cents(grossFor(emp, horas[0]));
  const l = linhasDePagamento(emp, horas, bruto, true);
  ok(soma(l) === bruto, "o centimo do arredondamento nao desaparece", { soma: soma(l), bruto });
}

// -------------------------------------------------------------- o override
console.log("\nBruto lancado a mao (override)");
{
  const emp = { id: "1", pay_type: "Hourly", hourly_rate: 16.35 };
  const horas = [{ hours: 40, sunday_hours: 0, gross_override: 900 }];
  const bruto = cents(grossFor(emp, horas[0]));
  const l = linhasDePagamento(emp, horas, bruto, true);

  ok(bruto === 90000, "o override MANDA sobre a conta das horas", bruto);
  ok(!l.some((x) => x.chave === "payslip.pay_basic"),
    "e o recibo NAO mostra '40h x 16,35' ao lado dele", l.map((x) => x.chave));
  ok(l.length === 1 && l[0].chave === "payslip.pay_gross", "sai uma linha unica de vencimento");
  ok(soma(l) === bruto, "que fecha com o bruto");
}

// ----------------------------------------------------------- contrato fixo
console.log("\nContrato fixo");
{
  const emp = { id: "1", pay_type: "Monthly Fixed", fixed_amount: 4000 };
  const horas = [{ week_worked: true }, { week_worked: true }, { week_worked: true }, { week_worked: true }];
  const bruto = horas.reduce((s, h) => s + cents(grossFor(emp, h)), 0);
  const l = linhasDePagamento(emp, horas, bruto, true);

  ok(l[0].chave === "payslip.pay_salary", "a linha e o salario, nao horas");
  ok(l[0].horas === null, "e um salariado nao leva colunas de horas");
  ok(soma(l) === bruto, "e fecha com o bruto rateado", { soma: soma(l), bruto });
}

console.log("\nSemana sem trabalho nenhum");
{
  const emp = { id: "1", pay_type: "Hourly", hourly_rate: 16.35 };
  const l = linhasDePagamento(emp, [], 0, true);
  ok(l.length === 1 && l[0].valorCents === 0,
    "sai uma linha a zero, e nao um recibo sem linha nenhuma", l);
}

// ------------------------------------------------------------- as horas off
console.log("\nA empresa que nao quer horas no recibo");
{
  const emp = { id: "1", pay_type: "Hourly", hourly_rate: 16.35, sunday_rate: 20 };
  const horas = [{ hours: 32, sunday_hours: 8, holiday_hours: 4 }];
  const bruto = cents(grossFor(emp, horas[0]));
  const l = linhasDePagamento(emp, horas, bruto, false);

  ok(l.every((x) => x.horas === null && x.taxaCents === null),
    "nenhuma linha mostra horas ou taxa");
  ok(!l.some((x) => x.chave === "payslip.pay_holidayTaken"),
    "e as ferias gozadas, que sao so horas, tambem nao saem");
  ok(soma(l) === bruto, "o VALOR nao muda por se esconderem as horas", { soma: soma(l), bruto });
}

console.log("\nFerias gozadas");
{
  const emp = { id: "1", pay_type: "Hourly", hourly_rate: 16.35 };
  const horas = [{ hours: 24, sunday_hours: 0, holiday_hours: 8 }];
  const bruto = cents(grossFor(emp, horas[0]));
  const l = linhasDePagamento(emp, horas, bruto, true);
  const ferias = l.find((x) => x.chave === "payslip.pay_holidayTaken");

  ok(!!ferias, "a linha aparece, porque a pessoa quer ver o saldo mexer");
  ok(ferias.valorCents === 0,
    "mas VALE ZERO: o tempo gozado ja foi pago, e soma-lo pagava duas vezes");
  ok(soma(l) === bruto, "e o bruto continua a fechar", { soma: soma(l), bruto });
}

// ------------------------------------------------------------- o ficheiro
console.log("\nO nome do ficheiro");
{
  ok(nomeDoPayslip("José Antônio da Silva", 2026, 35, "weekly")
    === "payslip-Jose-Antonio-da-Silva-2026-W35.pdf",
    "leva o nome da pessoa, sem acentos e sem espacos",
    nomeDoPayslip("José Antônio da Silva", 2026, 35, "weekly"));
  ok(nomeDoPayslip("Ana", 2026, 9, "monthly") === "payslip-Ana-2026-M09.pdf",
    "o mensal e M, e o periodo leva zero a esquerda");
  ok(nomeDoPayslip("Ana", 2026, 35, "weekly", true).startsWith("DRAFT-"),
    "e o rascunho diz que e rascunho ja no nome do ficheiro");
  ok(nomeDoPayslip("", 2026, 1, "weekly") === "payslip-employee-2026-W01.pdf",
    "sem nome nao sai um ficheiro chamado '--'");
}

console.log("\nO rotulo do periodo");
{
  ok(rotuloDoPeriodo("weekly", 35).codigo === "payslip.periodWeek", "semana");
  ok(rotuloDoPeriodo("monthly", 9).params.n === 9, "e leva o numero como parametro");
  ok(rotuloDoPeriodo("monthly", 9).codigo === "payslip.periodMonth",
    "chave e nao frase: o recibo sai no idioma de quem o le");
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
