/**
 * O que faz de um ajuste um lancamento valido — teste.
 *
 * Ajustar nao e editar: o original nao e reescrito, e estornado e relancado.
 * Um `update` por cima nao deixa rasto nenhum, e "nao perder o rastro" era
 * metade do pedido do Alfredo.
 *
 * A critica das linhas vive sem banco de proposito — o que decide se um
 * lancamento pode entrar no razao nao pode depender de haver um Postgres.
 */
const { criticarAjuste, houveMudanca } = require("../.test-build/accounting/ajustePuro");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const PLANO = new Set(["6750", "1300", "2100", "9999"]);

console.log("\n== o que entra ==");
{
  const r = criticarAjuste([
    { account_code: "6750", debit: 180, credit: 0 },
    { account_code: "1300", debit: 41.4, credit: 0 },
    { account_code: "2100", debit: 0, credit: 221.4 },
  ], PLANO);
  ok(r.ok, "lancamento que fecha", r.erro);
  ok(r.ok && r.linhas.length === 3, "com as tres linhas");

  // A tela manda sempre uma linha vazia no fim, para dar para acrescentar sem
  // carregar em nada. Ela nao pode virar uma linha de zero no razao.
  const v = criticarAjuste([
    { account_code: "6750", debit: 10, credit: 0 },
    { account_code: "2100", debit: 0, credit: 10 },
    { account_code: "", debit: 0, credit: 0 },
  ], PLANO);
  ok(v.ok && v.linhas.length === 2, "a linha vazia da tela e descartada em silencio", v.ok && v.linhas.length);

  // Arredonda ao centimo, e nao guarda a dizima do JavaScript.
  const c = criticarAjuste([
    { account_code: "6750", debit: 0.1 + 0.2, credit: 0 },
    { account_code: "2100", debit: 0, credit: 0.3 },
  ], PLANO);
  ok(c.ok && c.linhas[0].debit === 0.3, "0.1 + 0.2 entra como 0.30", c.ok && c.linhas[0].debit);
}

console.log("\n== o que NAO entra ==");
{
  const d = criticarAjuste([
    { account_code: "6750", debit: 100, credit: 0 },
    { account_code: "2100", debit: 0, credit: 90 },
  ], PLANO);
  ok(!d.ok && /10\.00/.test(d.erro), "desbalanceado, e a mensagem diz de quanto", d.erro);

  // Conta sintetica, inactiva ou fora do plano: o `trial_balance` faz LEFT
  // JOIN, entao a linha e DESCARTADA do balancete e do balanco em silencio,
  // com o lancamento a continuar la, balanceado. Recusa-se antes de existir.
  const p = criticarAjuste([
    { account_code: "7777777", debit: 10, credit: 0 },
    { account_code: "2100", debit: 0, credit: 10 },
  ], PLANO);
  ok(!p.ok && /nao existe no plano|não existe no plano/.test(p.erro), "conta fora do plano", p.erro);

  // Debito E credito na mesma linha e sempre engano de digitacao: da uma linha
  // que balanceia sozinha e nao faz nada.
  const dc = criticarAjuste([
    { account_code: "6750", debit: 10, credit: 10 },
    { account_code: "2100", debit: 0, credit: 10 },
  ], PLANO);
  ok(!dc.ok && /débito OU crédito|debito OU credito/.test(dc.erro), "os dois lados na mesma linha", dc.erro);

  const neg = criticarAjuste([
    { account_code: "6750", debit: -10, credit: 0 },
    { account_code: "2100", debit: 0, credit: -10 },
  ], PLANO);
  ok(!neg.ok && /negativo/.test(neg.erro), "valor negativo — troca-se o lado, nao o sinal", neg.erro);

  const uma = criticarAjuste([{ account_code: "6750", debit: 10, credit: 0 }], PLANO);
  ok(!uma.ok && /duas linhas/.test(uma.erro), "uma linha so nao e partida dobrada", uma.erro);

  const zero = criticarAjuste([
    { account_code: "6750", debit: 0, credit: 0 },
    { account_code: "2100", debit: 0, credit: 0 },
  ], PLANO);
  ok(!zero.ok, "lancamento de zero", zero.erro);

  const sc = criticarAjuste([
    { account_code: "  ", debit: 10, credit: 0 },
    { account_code: "2100", debit: 0, credit: 10 },
  ], PLANO);
  ok(!sc.ok && /falta a conta/.test(sc.erro), "linha com valor e sem conta", sc.erro);
}

console.log("\n== ajuste que nao ajusta nada ==");
{
  // Tres partidas onde havia uma, e nenhuma delas muda um numero: so suja o
  // razao e o historico com trabalho que nao aconteceu.
  const antes = [
    { account_code: "6750", debit: 180, credit: 0 },
    { account_code: "2100", debit: 0, credit: 180 },
  ];
  ok(!houveMudanca(antes, [...antes]), "linhas iguais");
  ok(!houveMudanca(antes, [antes[1], antes[0]]), "iguais por outra ordem — a ordem nao e o lancamento");
  ok(houveMudanca(antes, [
    { account_code: "9999", debit: 180, credit: 0 },
    { account_code: "2100", debit: 0, credit: 180 },
  ]), "conta trocada");
  ok(houveMudanca(antes, [
    { account_code: "6750", debit: 190, credit: 0 },
    { account_code: "2100", debit: 0, credit: 190 },
  ]), "valor trocado");
  ok(houveMudanca(antes, [...antes, ...antes]), "linha acrescentada");
}

console.log("\n== sem plano, a verificacao de conta desliga ==");
{
  // `null` serve o teste, nao a rota: la o plano vem sempre do banco.
  const r = criticarAjuste([
    { account_code: "conta-que-nao-existe", debit: 5, credit: 0 },
    { account_code: "outra", debit: 0, credit: 5 },
  ], null);
  ok(r.ok, "passa, porque nao ha plano contra o que conferir", r.erro);
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
