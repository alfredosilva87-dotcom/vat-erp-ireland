/**
 * Divisao de um pagamento entre varios documentos — testes.
 *
 * Roda com `npm test`, que compila lib/bankSplit.ts antes.
 *
 * Duas coisas estes testes protegem, e as duas sao sobre dinheiro sumindo:
 * a soma das partes tem que ser sempre o valor da linha, e diferenca nenhuma
 * pode desaparecer em silencio.
 */
const S = require("../.test-build/bankSplit.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
const soma = (plan) => Number(plan.parts.reduce((s, p) => s + p.amount, 0).toFixed(2));

console.log("\n== um pagamento cobrindo tres notas ==");
let p = S.planSettlement(-300, [
  { key: "a", outstanding: 100 },
  { key: "b", outstanding: 150 },
  { key: "c", outstanding: 50 },
]);
ok(soma(p) === 300, "as tres foram cobertas por inteiro", p.parts);
ok(p.balanced && p.leftover === 0, "fecha exatamente", p);
ok(!p.parts.some((x) => x.partial), "nenhuma ficou parcial", p.parts);

console.log("\n== pagamento parcial deixa o saldo certo em aberto ==");
p = S.planSettlement(-60, [{ key: "a", outstanding: 100 }]);
ok(p.parts[0].amount === 60, "aplica os 60", p.parts[0]);
ok(p.parts[0].partial === true, "marcado como parcial");
ok(p.parts[0].remaining === 40, "restam 40 em aberto", p.parts[0]);
ok(p.balanced, "e a linha fecha assim mesmo");

console.log("\n== o que nao cabe nao e aplicado ==");
p = S.planSettlement(-120, [
  { key: "a", outstanding: 100 },
  { key: "b", outstanding: 100 },
]);
ok(p.parts[0].amount === 100 && p.parts[1].amount === 20, "a primeira inteira, a segunda parcial", p.parts);
ok(p.parts[1].remaining === 80, "e a segunda continua devendo 80", p.parts[1]);

console.log("\n== nunca oferecer mais do que o documento deve ==");
p = S.planSettlement(-500, [{ key: "a", outstanding: 100 }]);
ok(p.parts[0].amount === 100, "aplica so os 100 que ele deve", p.parts[0]);
ok(p.unexplained !== null, "e diz que sobraram 400 sem explicacao", p.unexplained);
ok(!p.balanced, "nao fecha — e nao finge que fechou");

console.log("\n== diferenca de centavos vira arredondamento visivel ==");
p = S.planSettlement(-100.02, [{ key: "a", outstanding: 100 }]);
ok(p.rounding !== null && Math.abs(p.rounding + 0.02) < 0.001, "2 centavos viram arredondamento", p.rounding);
ok(p.balanced, "e com isso a linha fecha", p);
ok(p.unexplained === null, "nao e tratado como sobra inexplicada");

let alloc = S.planToAllocations(-100.02, p, [{ key: "a", invoiceId: "inv1" }], "9999");
ok(alloc.length === 2, "dois lancamentos: a nota e o arredondamento", alloc);
ok(alloc[0].amount === -100 && alloc[0].invoiceId === "inv1", "a nota recebe 100 exatos", alloc[0]);
ok(alloc[1].amount === -0.02 && alloc[1].accountCode === "9999", "o centavo tem conta propria", alloc[1]);
ok(Number(alloc.reduce((s, a) => s + a.amount, 0).toFixed(2)) === -100.02, "e a soma e a linha", alloc);

console.log("\n== tarifa bancaria NAO e arredondamento ==");
p = S.planSettlement(-105, [{ key: "a", outstanding: 100 }]);
ok(p.rounding === null, "5 euros nao passam por arredondamento");
ok(p.unexplained !== null && Math.abs(p.unexplained + 5) < 0.001, "sao sobra a explicar", p.unexplained);
ok(p.warnings.some((w) => w.toLowerCase().includes("tarifa")), "e o aviso sugere tarifa", p.warnings);

console.log("\n== valor digitado manda no automatico ==");
p = S.planSettlement(-300, [
  { key: "a", outstanding: 200, amount: 50 },
  { key: "b", outstanding: 500 },
]);
ok(p.parts[0].amount === 50, "respeita os 50 digitados", p.parts[0]);
ok(p.parts[1].amount === 250, "e o resto vai para a outra", p.parts[1]);
ok(p.balanced, "fecha");

console.log("\n== entrada de dinheiro mantem o sinal ==");
p = S.planSettlement(1230, [{ key: "v", outstanding: 1230 }]);
alloc = S.planToAllocations(1230, p, [{ key: "v", saleId: "s1" }]);
ok(alloc[0].amount === 1230 && alloc[0].saleId === "s1", "recebimento fica positivo", alloc[0]);

console.log("\n== documentos somando MAIS que a linha ==");
// `leftover` e o que AINDA FALTA LANCAR para fechar, no sinal em que seria
// lancado. A linha e -100 e os documentos consomem -130, entao falta +30 para
// a soma voltar a ser a linha — e e esse o numero que iria no ajuste.
p = S.planSettlement(-100, [
  { key: "a", outstanding: 100, amount: 80 },
  { key: "b", outstanding: 100, amount: 50 },
]);
ok(Math.abs(p.leftover - 30) < 0.001, "faltam +30 para fechar (documentos passaram do valor)", p.leftover);
ok(!p.balanced, "e nao fecha");
ok(p.warnings.some((w) => w.includes("a mais")), "e o aviso diz que passaram", p.warnings);

console.log("\n== nenhum documento marcado ==");
p = S.planSettlement(-45.2, []);
ok(p.parts.length === 0 && !p.balanced, "sem documento nao fecha sozinho", p);
ok(p.unexplained !== null, "o valor inteiro fica por explicar", p.unexplained);

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========`);
process.exit(fail ? 1 : 0);
