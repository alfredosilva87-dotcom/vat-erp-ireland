/**
 * Sugestao de casamento extrato <-> documento — testes.
 *
 * Roda com `npm test`, que compila lib/bankMatch.ts antes.
 *
 * O que estes testes protegem nao e "achar o documento certo" — e nao propor
 * com confianca quando a evidencia nao da para isso. Uma proposta errada
 * confirmada com um clique vira vinculo errado sem ninguem ter decidido nada.
 */
const M = require("../.test-build/bankMatch.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const nota = (over) => Object.assign({
  kind: "invoice", id: "i1", party: "ESB Energy Ltd", doc_number: "2026-014",
  doc_date: "2026-01-20", total: 88.10, outstanding: 88.10,
}, over);
const venda = (over) => Object.assign({
  kind: "sale", id: "s1", party: "Acme Catering", doc_number: "V-3001",
  doc_date: "2026-01-03", total: 2500, outstanding: 2500,
}, over);
const linha = (over) => Object.assign({
  line_date: "2026-01-22", amount: -88.10, description: "ESB ENERGY DD", reference: null,
}, over);

// ------------------------------------------------- o caso que tem que funcionar
console.log("\n== pagamento de nota lancada e proposto sozinho ==");
let s = M.suggestMatches(linha(), [nota()]);
ok(s.length === 1, "achou candidato", s.length);
ok(!!M.bestSuggestion(s), "e proposto com confianca", s[0] && s[0].score);
ok(s[0].exactAmount, "valor exato reconhecido");

console.log("\n== numero do documento na descricao e o sinal mais forte ==");
s = M.suggestMatches(
  linha({ description: "INV 2026-014 PAYMENT", amount: -50 }),
  [nota(), nota({ id: "i2", party: "Outro", doc_number: "9999", total: 50, outstanding: 50 })]
);
ok(s[0].candidate.id === "i1", "numero bate mais que valor igual", s.map((x) => [x.candidate.id, x.score]));

console.log("\n== formatos diferentes do mesmo numero ==");
for (const desc of ["INV 2026-014 PAYMENT", "pagamento inv2026/014", "REF: 2026014"]) {
  const r = M.suggestMatches(linha({ description: desc, amount: -10 }), [nota()]);
  ok(r.length > 0 && r[0].reasons.some((x) => x.includes("2026-014")), `"${desc}" reconhecido`, r[0]);
}

console.log("\n== numero curto NAO casa por acidente ==");
s = M.suggestMatches(
  linha({ description: "PAGAMENTO 14 DE JANEIRO", amount: -10 }),
  [nota({ doc_number: "14", total: 10, outstanding: 10 })]
);
ok(!s[0].reasons.some((r) => r.includes("aparece na descricao") || r.includes("Número")),
  "numero de 2 digitos ignorado", s[0].reasons);

// ------------------------------------------------- quando NAO propor
console.log("\n== empate nao vira proposta ==");
s = M.suggestMatches(linha({ description: "PAGAMENTO", amount: -88.10 }), [
  nota({ id: "a", party: null, doc_number: null, doc_date: "2026-01-22" }),
  nota({ id: "b", party: null, doc_number: null, doc_date: "2026-01-22" }),
]);
ok(s.length === 2 && s[0].score === s[1].score, "dois candidatos empatados", s.map((x) => x.score));
ok(M.bestSuggestion(s) === null, "NAO propoe nenhum — o contador escolhe");

console.log("\n== nome + valor exato bastam, a data nao pode decidir sozinha ==");
// Regressao: com limiar 55, esta mesma nota era proposta a 3 dias de distancia
// e deixava de ser a 4, porque so ai o bonus de data caia de 10 para 6.
for (const [dataNota, dias] of [["2026-01-18", 1], ["2026-01-15", 4], ["2026-01-05", 14]]) {
  const r = M.suggestMatches(
    linha({ line_date: "2026-01-19", amount: -30, description: "VODAFONE IRELAND" }),
    [nota({ party: "Vodafone Ireland", doc_number: "VF-2026-0119", doc_date: dataNota, total: 30, outstanding: 30 })]
  );
  ok(!!M.bestSuggestion(r), `proposto com a nota ${dias} dia(s) antes`, r[0] && r[0].score);
}

console.log("\n== mas um sinal sozinho continua NAO bastando ==");
s = M.suggestMatches(
  linha({ line_date: "2026-06-01", amount: -30, description: "PAGAMENTO CARTAO" }),
  [nota({ party: "Vodafone Ireland", doc_number: null, doc_date: "2026-05-30", total: 30, outstanding: 30 })]
);
ok(M.bestSuggestion(s) === null, "valor exato sem nome nao e proposta", s[0] && s[0].score);
s = M.suggestMatches(
  linha({ line_date: "2026-06-01", amount: -777, description: "VODAFONE IRELAND" }),
  [nota({ party: "Vodafone Ireland", doc_number: null, doc_date: "2026-05-30", total: 30, outstanding: 30 })]
);
ok(M.bestSuggestion(s) === null, "nome sem valor nao e proposta", s[0] && s[0].score);

console.log("\n== evidencia fraca nao vira proposta ==");
s = M.suggestMatches(
  linha({ description: "COMPRA CARTAO", amount: -19.99 }),
  [nota({ party: null, doc_number: null, total: 1000, outstanding: 1000 })]
);
ok(M.bestSuggestion(s) === null, "so a data nao basta", s[0] && s[0].score);

// ------------------------------------------------- direcao do dinheiro
console.log("\n== direcao do dinheiro ==");
s = M.suggestMatches(linha({ amount: 2500, description: "RECEBIMENTO ACME" }), [venda(), nota()]);
ok(s[0].candidate.kind === "sale", "entrada casa com venda", s.map((x) => [x.candidate.kind, x.score]));

s = M.suggestMatches(linha({ amount: -2500, description: "PAGAMENTO ACME" }), [venda()]);
ok(s.length === 0 || s[0].score < M.CONFIDENT_SCORE, "saida x venda nao e proposta", s[0] && s[0].score);
ok(s.length === 0 || s[0].reasons.some((r) => r.startsWith("Aten")), "e o motivo e dito", s[0] && s[0].reasons);

// ------------------------------------------------- pagamento parcial
console.log("\n== pagamento parcial: o que conta e o SALDO, nao o total ==");
s = M.suggestMatches(
  linha({ amount: -38.10, description: "ESB ENERGY DD" }),
  [nota({ total: 88.10, outstanding: 38.10 })]
);
ok(s[0].exactAmount, "bate com o saldo em aberto", s[0]);
ok(!!M.bestSuggestion(s), "proposto com confianca");

console.log("\n== empate desfeito pela data mais proxima ==");
s = M.suggestMatches(linha({ line_date: "2026-01-22", amount: -88.10, description: "ESB" }), [
  nota({ id: "longe", doc_date: "2026-01-01", party: "ESB Energy Ltd" }),
  nota({ id: "perto", doc_date: "2026-01-21", party: "ESB Energy Ltd" }),
]);
ok(s[0].candidate.id === "perto", "a mais proxima ganha", s.map((x) => [x.candidate.id, x.score]));

console.log("\n== nome generico nao carrega o casamento ==");
s = M.suggestMatches(
  linha({ description: "THE COMPANY LTD", amount: -12.34 }),
  [nota({ party: "The Company Ltd", doc_number: null, total: 999, outstanding: 999 })]
);
ok(!s.length || !s[0].reasons.some((r) => r.includes("aparece na descrição")),
  "so palavras de ruido nao contam", s[0] && s[0].reasons);

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========`);
process.exit(fail ? 1 : 0);
