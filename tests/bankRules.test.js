/**
 * Regras de banco — testes.
 *
 * Roda com `npm test`, que compila lib/bankRules.ts antes.
 *
 * O comportamento mais sutil aqui e a ORDEM: para na primeira regra que casa.
 * Uma regra generica no topo engole as especificas, e o sintoma e mudo — a
 * regra especifica esta la, escrita certa, e simplesmente nunca acontece.
 */
const R = require("../.test-build/bankRules.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

let n = 0;
const regra = (over) => Object.assign({
  id: "r" + (++n), name: "regra", priority: 100, match_all: true,
  conditions: [{ field: "description", op: "contains", value: "ESB" }],
  allocations: [{ account_code: "6100", vat_rate: 23, percent: 100 }],
  contact_name: null, bank_account_id: null, active: true,
}, over);
const linha = (over) => Object.assign({
  description: "ESB ENERGY DD", payee: null, reference: null, amount: -88.10,
}, over);

console.log("\n== casar por texto ==");
ok(R.ruleMatches(linha(), regra()), "contem");
ok(R.ruleMatches(linha(), regra({ conditions: [{ field: "description", op: "starts_with", value: "esb" }] })), "comeca com, sem ligar para maiuscula");
ok(R.ruleMatches(linha(), regra({ conditions: [{ field: "description", op: "equals", value: "esb energy dd" }] })), "igual");
ok(!R.ruleMatches(linha(), regra({ conditions: [{ field: "description", op: "equals", value: "esb" }] })), "igual NAO e contem");

console.log("\n== todas x qualquer ==");
const duas = [
  { field: "description", op: "contains", value: "ESB" },
  { field: "description", op: "contains", value: "NAO EXISTE" },
];
ok(!R.ruleMatches(linha(), regra({ conditions: duas, match_all: true })), "todas: uma falha derruba");
ok(R.ruleMatches(linha(), regra({ conditions: duas, match_all: false })), "qualquer: uma basta");

console.log("\n== regra sem condicao NAO casa com tudo ==");
ok(!R.ruleMatches(linha(), regra({ conditions: [] })), "lista vazia nao vira curinga");

console.log("\n== valor e comparado pela magnitude ==");
ok(R.ruleMatches(linha(), regra({ conditions: [{ field: "amount", op: "gt", value: "50" }] })),
  "-88,10 e 'acima de 50' para quem le o extrato");
ok(R.ruleMatches(linha(), regra({ conditions: [{ field: "amount", op: "lt", value: "100" }] })), "e 'abaixo de 100'");
ok(R.ruleMatches(linha(), regra({ conditions: [{ field: "amount", op: "equals", value: "88.10" }] })), "igual ao centimo");

console.log("\n== escopo de conta ==");
ok(!R.ruleMatches(linha(), regra({ bank_account_id: "conta-A" }), "conta-B"), "regra de outra conta nao vale");
ok(R.ruleMatches(linha(), regra({ bank_account_id: null }), "conta-B"), "regra sem conta vale para todas");

console.log("\n== inativa nao casa ==");
ok(!R.ruleMatches(linha(), regra({ active: false })), "desligada fica desligada");

// ------------------------------------------------------------- ORDEM
console.log("\n== para na primeira que casa ==");
const generica = regra({ id: "generica", name: "tudo que e TESCO", priority: 10,
  conditions: [{ field: "description", op: "contains", value: "TESCO" }],
  allocations: [{ account_code: "6000", percent: 100 }] });
const especifica = regra({ id: "especifica", name: "TESCO EXPRESS", priority: 20,
  conditions: [{ field: "description", op: "contains", value: "TESCO EXPRESS" }],
  allocations: [{ account_code: "6001", percent: 100 }] });

let out = R.applyRules(linha({ description: "TESCO EXPRESS DUBLIN", amount: -12 }), [generica, especifica]);
ok(out.rule.id === "generica", "a de prioridade menor ganha", out.rule.id);
ok(out.shadowed.length === 1 && out.shadowed[0].id === "especifica", "e a engolida e reportada", out.shadowed.map((r) => r.id));

out = R.applyRules(linha({ description: "TESCO EXPRESS DUBLIN", amount: -12 }),
  [Object.assign({}, generica, { priority: 20 }), Object.assign({}, especifica, { priority: 10 })]);
ok(out.rule.id === "especifica", "reordenar resolve", out.rule.id);

console.log("\n== aviso de regra que nunca vai acontecer ==");
const sombras = R.findShadowedRules([generica, especifica]);
ok(sombras.length === 1 && sombras[0].rule.id === "especifica" && sombras[0].shadowedBy.id === "generica",
  "acusa a especifica engolida pela generica", sombras.map((s) => [s.rule.id, s.shadowedBy.id]));
ok(R.findShadowedRules([Object.assign({}, generica, { priority: 20 }), Object.assign({}, especifica, { priority: 10 })]).length === 0,
  "na ordem certa, nenhum aviso");
ok(R.findShadowedRules([
  regra({ id: "a", priority: 10, conditions: [{ field: "description", op: "contains", value: "TESCO" }] }),
  regra({ id: "b", priority: 20, conditions: [{ field: "description", op: "contains", value: "DUNNES" }] }),
]).length === 0, "regras sobre coisas diferentes nao se engolem");

console.log("\n== nenhuma regra casa ==");
ok(R.applyRules(linha({ description: "COISA NOVA" }), [generica, especifica]) === null, "devolve nada, nao inventa");

// ------------------------------------------------------- divisao do valor
console.log("\n== divisao percentual fecha o valor da linha ==");
let alloc = R.resolveAllocations(-100, [
  { account_code: "A", percent: 60 }, { account_code: "B", percent: 40 },
]);
ok(alloc.length === 2 && alloc[0].amount === -60 && alloc[1].amount === -40, "60/40", alloc);
ok(Math.abs(alloc.reduce((s, a) => s + a.amount, 0) + 100) < 0.001, "soma fecha");

console.log("\n== centimo que sobra vai para a MAIOR parcela ==");
alloc = R.resolveAllocations(-100, [
  { account_code: "A", percent: 33.33 }, { account_code: "B", percent: 33.33 }, { account_code: "C", percent: 33.34 },
]);
const soma = alloc.reduce((s, a) => s + a.amount, 0);
ok(Math.abs(soma + 100) < 0.001, "tres partes ainda fecham em 100", { alloc, soma });

alloc = R.resolveAllocations(-10, [
  { account_code: "A", percent: 33.333 }, { account_code: "B", percent: 33.333 }, { account_code: "C", percent: 33.334 },
]);
ok(Math.abs(alloc.reduce((s, a) => s + a.amount, 0) + 10) < 0.001, "e em 10 tambem", alloc);

console.log("\n== valor fixo e o resto ==");
alloc = R.resolveAllocations(-100, [
  { account_code: "TARIFA", amount: 5 }, { account_code: "RESTO" },
]);
ok(alloc[0].amount === -5 && alloc[1].amount === -95, "fixo 5, resto 95", alloc);

console.log("\n== o sinal vem da linha, nao da regra ==");
alloc = R.resolveAllocations(250, [{ account_code: "VENDAS", percent: 100 }]);
ok(alloc[0].amount === 250, "entrada continua positiva", alloc);

console.log("\n== sem alocacao configurada, uma parcela unica ==");
alloc = R.resolveAllocations(-42.5, []);
ok(alloc.length === 1 && alloc[0].amount === -42.5, "valor inteiro em uma parcela", alloc);

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========`);
process.exit(fail ? 1 : 0);
