/**
 * Relatorio de fechamento — testes.
 *
 * Roda com `npm test`, que compila lib/closingReport.ts antes.
 *
 * O relatorio existe para responder uma pergunta so: o que o banco diz que
 * aconteceu esta todo lancado aqui? Estes testes protegem as DUAS diferencas
 * que costumam ser confundidas — extrato x sistema (sempre explicada pelas
 * pendencias) e calculado x informado (que so aparece quando falta importar).
 */
const C = require("../.test-build/closingReport.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const linha = (id, data, valor, status, desc) =>
  ({ id, line_date: data, amount: valor, status: status || "reconciled", description: desc || id });
const txn = (id, data, valor, linhaId) =>
  ({ id, txn_date: data, amount: valor, statement_line_id: linhaId ?? null, description: id });

console.log("\n== tudo conciliado: diferenca zero ==");
let r = C.buildClosingReport({
  openingBalance: 1000,
  lines: [linha("l1", "2026-01-02", -45.2), linha("l2", "2026-01-05", 2500)],
  transactions: [txn("t1", "2026-01-02", -45.2, "l1"), txn("t2", "2026-01-05", 2500, "l2")],
  reportedBalance: 3454.8,
});
ok(r.statementBalance === 3454.8, "saldo do extrato calculado", r.statementBalance);
ok(r.systemBalance === 3454.8, "saldo do sistema igual", r.systemBalance);
ok(r.gap === 0 && r.gapExplained, "sem diferenca entre as duas series", r);
ok(r.difference === 0, "e o saldo informado bate", r.difference);
ok(r.closable, "pode fechar");

console.log("\n== falta uma linha: a diferenca aponta EXATAMENTE ela ==");
// O contador leu 3454,80 no papel, mas so importou a primeira linha.
r = C.buildClosingReport({
  openingBalance: 1000,
  lines: [linha("l1", "2026-01-02", -45.2)],
  transactions: [txn("t1", "2026-01-02", -45.2, "l1")],
  reportedBalance: 3454.8,
});
ok(r.statementBalance === 954.8, "extrato importado soma 954,80", r.statementBalance);
ok(Math.abs(r.difference - 2500) < 0.001, "a diferenca e 2500 — o valor da linha que falta", r.difference);
ok(!r.closable, "e nao deixa fechar", r.closable);
ok(r.notes.some((n) => n.includes("falta importar")), "e diz o que provavelmente aconteceu", r.notes);

console.log("\n== pendencia legitima NAO impede fechar ==");
// Cheque emitido e ainda nao compensado: esta lancado aqui e nao no extrato.
r = C.buildClosingReport({
  openingBalance: 1000,
  lines: [linha("l1", "2026-01-02", -45.2)],
  transactions: [txn("t1", "2026-01-02", -45.2, "l1"), txn("t2", "2026-01-28", -300)],
  reportedBalance: 954.8,
});
ok(r.systemBalance === 654.8, "o sistema ja tirou os 300", r.systemBalance);
ok(r.gap === 300, "a diferenca entre as series e 300", r.gap);
ok(r.gapExplained, "e ela e explicada pelo pagamento em aberto");
ok(r.outstanding.count === 1 && r.outstanding.total === -300, "que aparece listado", r.outstanding);
ok(r.difference === 0 && r.closable, "o mes fecha assim mesmo — a pendencia e legitima");

console.log("\n== linha do extrato ainda nao conciliada ==");
r = C.buildClosingReport({
  openingBalance: 1000,
  lines: [linha("l1", "2026-01-02", -45.2), linha("l2", "2026-01-09", -88.1, "unreconciled")],
  transactions: [txn("t1", "2026-01-02", -45.2, "l1")],
  reportedBalance: 866.7,
});
ok(r.unreconciled.count === 1 && r.unreconciled.total === -88.1, "a pendencia aparece", r.unreconciled);
ok(r.gap === -88.1 && r.gapExplained, "e explica a diferenca entre as series", r.gap);
ok(r.difference === 0 && r.closable, "o extrato inteiro entrou, entao fecha");

console.log("\n== linha ignorada nao entra no saldo, mas nao some do relatorio ==");
r = C.buildClosingReport({
  openingBalance: 1000,
  lines: [linha("l1", "2026-01-02", -45.2), linha("lx", "2026-01-03", -999, "ignored")],
  transactions: [txn("t1", "2026-01-02", -45.2, "l1")],
});
ok(r.statementBalance === 954.8, "os 999 ficaram de fora do saldo", r.statementBalance);
ok(r.ignored.count === 1 && r.ignored.total === -999, "e aparecem como ignorados", r.ignored);

console.log("\n== sem saldo informado, o relatorio ainda serve ==");
r = C.buildClosingReport({
  openingBalance: 1000,
  lines: [linha("l1", "2026-01-02", -45.2)],
  transactions: [txn("t1", "2026-01-02", -45.2, "l1")],
});
ok(r.difference === null, "nao inventa diferenca", r.difference);
ok(r.closable, "e nao impede fechar so por nao ter sido digitado");

console.log("\n== extrato importado a MAIS que o papel ==");
r = C.buildClosingReport({
  openingBalance: 1000,
  lines: [linha("l1", "2026-01-02", 100), linha("l2", "2026-01-02", 100)],
  transactions: [],
  reportedBalance: 1100,
});
ok(Math.abs(r.difference + 100) < 0.001, "acusa 100 a mais", r.difference);
ok(r.notes.some((n) => n.includes("duas vezes")), "e sugere linha duplicada", r.notes);

// ------------------------------------------------------- duplicatas
console.log("\n== duplicatas em potencial ==");
let pares = C.findPotentialDuplicates([
  linha("a", "2026-01-02", -45.2, "reconciled", "TESCO STORES DUBLIN"),
  linha("b", "2026-01-02", -45.2, "unreconciled", "TESCO STORES"),
  linha("c", "2026-01-05", -45.2, "reconciled", "TESCO STORES"),
]);
ok(pares.length === 1, "mesma data, mesmo valor e descricao parecida", pares.map((p) => [p[0].id, p[1].id]));
ok(pares[0][0].id === "a" && pares[0][1].id === "b", "o par certo", pares[0]);

pares = C.findPotentialDuplicates([
  linha("a", "2026-01-02", -4.5, "reconciled", "CAFE NERO"),
  linha("b", "2026-01-02", -4.5, "reconciled", "LIDL"),
]);
ok(pares.length === 0, "mesmo valor com fornecedor diferente nao e duplicata", pares);

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========`);
process.exit(fail ? 1 : 0);
