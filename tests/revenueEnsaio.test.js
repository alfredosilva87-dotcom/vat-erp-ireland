const assert = require("assert");
const { ehClienteDeDemonstracao, rpnDeEnsaio } = require("../.test-build/revenue/ensaio.js");

/*
 * A TRAVA do ensaio — o que este teste protege.
 *
 * Semear dado fiscal falso num sistema de folha só é aceitável enquanto for
 * IMPOSSÍVEL de confundir com o verdadeiro e IMPOSSÍVEL de acontecer num
 * cliente real. Se alguma destas asserções deixar de valer, alguém corre uma
 * folha real com créditos que a Revenue nunca deu, e o trabalhador leva a
 * diferença como dívida no fim do ano.
 */

// ------------------------------------------------- só cliente de demonstração
{
  assert.strictEqual(ehClienteDeDemonstracao("DEMO-COR"), true);
  assert.strictEqual(ehClienteDeDemonstracao("demo-dub"), true, "o caso da letra nao decide nada");

  // Um cliente real do escritório NUNCA passa aqui.
  assert.strictEqual(ehClienteDeDemonstracao("A1TEST"), false);
  assert.strictEqual(ehClienteDeDemonstracao("CORK01"), false);
  // E o prefixo é do PRINCÍPIO. "X-DEMO-1" não é um cliente de demonstração;
  // aceitá-lo abriria a trava a qualquer código que contivesse a palavra.
  assert.strictEqual(ehClienteDeDemonstracao("X-DEMO-1"), false);
  assert.strictEqual(ehClienteDeDemonstracao("DEMONSTRACAO"), false,
    "sem o traco nao e o prefixo: DEMONSTRACAO podia ser um cliente real");

  // Na dúvida, NÃO é de demonstração: recusar semear é o lado seguro do erro.
  assert.strictEqual(ehClienteDeDemonstracao(null), false);
  assert.strictEqual(ehClienteDeDemonstracao(undefined), false);
  assert.strictEqual(ehClienteDeDemonstracao(""), false);
  assert.strictEqual(ehClienteDeDemonstracao("   "), false);
}

// ------------------------------------------ a linha grita ensaio, sem excepção
{
  const l = rpnDeEnsaio({
    indice: 0, year: 2026, pps: "1234567AA", employmentId: "1",
    employerReg: "SIM2026", comAcumulado: false, quemPediu: "quem@escritorio.ie",
    agora: "2026-09-04T10:00:00.000Z",
  });

  // A marca nos DADOS — é ela que a limpeza usa, e ela não se perde numa cópia
  // como se perde uma convenção num campo de texto.
  assert.strictEqual(l.simulated, true);
  // E a marca no PAPEL: o número do RPN sai impresso no recibo.
  assert.ok(l.rpn_number.startsWith("SIM-"), "o numero do RPN tem de se ver no recibo");
  assert.strictEqual(l.raw.ensaio, true);
  assert.ok(String(l.raw.aviso).includes("Nao vieram da Revenue"),
    "quem for perguntar de onde veio o numero tem de encontrar a resposta no raw");

  /*
   * O RPN nasce a 1 de Janeiro do ano fiscal, como os verdadeiros.
   *
   * Com data de hoje, a folha de Março parecia que só passou a ter créditos
   * agora — e o cumulativo devolvia imposto de uma vez, sem razão nenhuma.
   */
  assert.strictEqual(l.effective_date, "2026-01-01");

  // Sem acumulado pedido, o acumulado é ZERO e não um valor por omissão: quem
  // não pediu não pode receber imposto já pago que nunca existiu.
  assert.strictEqual(l.tax_deducted_to_date, 0);
  assert.strictEqual(l.pay_tax_to_date, 0);
}

// ------------------------------------------------------- o acumulado é opcional
{
  const com = rpnDeEnsaio({
    indice: 3, year: 2026, pps: "7654321BB", employmentId: "2",
    employerReg: "SIM2026", comAcumulado: true, quemPediu: null,
  });
  // Redondos de propósito: um acumulado com cêntimos parece extraído de um
  // sistema, e é justamente essa a impressão que não se quer dar.
  assert.strictEqual(com.pay_tax_to_date, 800000);
  assert.strictEqual(com.tax_deducted_to_date, 60000);
  assert.strictEqual(com.usc_deducted_to_date, 15000);
  // O número segue o índice: dois funcionários não levam o mesmo RPN.
  assert.strictEqual(com.rpn_number, "SIM-2026-004");
}

console.log("revenueEnsaio: ok");
