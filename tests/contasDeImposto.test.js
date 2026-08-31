/**
 * As contas de imposto ficam fora da conciliacao de controlo — teste.
 *
 * O risco que isto guarda apareceu na primeira vez que se criou um titulo de
 * IVA: a conciliacao de controlo monta a lista de contas a partir das que
 * aparecem nos TITULOS, entao a conta de IVA entrou nela e trouxe consigo o
 * saldo ACUMULADO do imposto, para ser confrontado com um unico titulo.
 *
 * Resultado: uma diferenca permanente no ecra de contas a pagar, em todos os
 * clientes. E um falso alarme repetido ensina a ignorar o alarme — que e
 * exactamente o que o comentario de `control.ts` ja avisava.
 */
const C = require("../.test-build/fiscal/contasDeImposto.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

console.log("\n== quais sao contas de imposto ==");
{
  ok(C.ehContaDeImposto("845"), "845 IVA a pagar");
  ok(C.ehContaDeImposto("736"), "736 IVA a recuperar");
  ok(C.ehContaDeImposto("831"), "831 imposto sobre o lucro a pagar");
  ok(C.ehContaDeImposto("501"), "501 despesa de imposto");
}

console.log("\n== e quais NAO sao ==");
{
  // Estas sao as de controlo a serio: controlam faturas de TERCEIROS em aberto,
  // e e contra elas que a conciliacao de controlo tem de fechar.
  ok(!C.ehContaDeImposto("812"), "812 fornecedores NAO e conta de imposto");
  ok(!C.ehContaDeImposto("711"), "711 clientes NAO e conta de imposto");
  ok(!C.ehContaDeImposto("771"), "771 banco NAO e");
  ok(!C.ehContaDeImposto(null) && !C.ehContaDeImposto(undefined) && !C.ehContaDeImposto(""),
     "vazio nao e nada");
}

console.log("\n== espacos nao enganam ==");
{
  // O `account_code` vem do banco e ja apareceu com espaco a mais noutras
  // partes deste sistema. Um espaco aqui deixaria a conta de IVA passar pelo
  // filtro e o falso alarme voltava.
  ok(C.ehContaDeImposto(" 845 "), "com espacos continua a ser 845");
}

console.log("\n== a conta escolhida na tela tambem conta ==");
{
  // Desde que a conta do imposto passou a ser escolhida, a lista fixa deixou
  // de chegar: um titulo em 836 (RCT) ou 849 ficaria de fora e o falso alarme
  // permanente voltava — na conta seguinte, com a mesma cara.
  const conjunto = C.contasDeImposto(["836", " 849 ", null, ""]);
  ok(C.ehContaDeImposto("836", conjunto), "836 escolhida na tela entra");
  ok(C.ehContaDeImposto("849", conjunto), "849 com espacos entra");
  ok(C.ehContaDeImposto("845", conjunto), "as fixas continuam la");
  ok(!C.ehContaDeImposto("812", conjunto), "812 continua de fora");
  ok(!C.ehContaDeImposto("836"), "sem o conjunto, 836 nao e conta de imposto");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
