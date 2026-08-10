/**
 * Leitura de extrato bancario — testes.
 *
 * Rode com `npm test`, que compila lib/bankStatement.ts antes.
 *
 * Os formatos aqui sao SINTETICOS: ainda nao temos extratos reais dos bancos
 * dos clientes. Quando tivermos, o certo e acrescentar cada arquivo real como
 * mais um caso aqui — o objetivo e nunca corrigir um banco e quebrar outro.
 */
const B = require("../.test-build/bankStatement.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

// ------------------------------------------------------------ parseAmount
console.log("\n== valores como os bancos escrevem ==");
const A = [
  ["1234.56", 1234.56], ["1.234,56", 1234.56], ["1,234.56", 1234.56],
  ["-45,00", -45], ["(45.00)", -45], ["€ 12,00", 12], ["12.00 CR", 12],
  ["12.00 DR", -12], ["1.234", 1234], ["12,50", 12.5], ["", null], ["abc", null],
  ["0", 0], ["-0.01", -0.01], [1234.56, 1234.56],
];
for (const [input, expected] of A) {
  const got = B.parseAmount(input);
  ok(got === expected, `parseAmount(${JSON.stringify(input)}) = ${expected}`, got);
}

// ------------------------------------------------------------- parseDate
console.log("\n== datas como os bancos escrevem ==");
const D = [
  ["31/01/2026", "dmy", "2026-01-31"], ["01/31/2026", "mdy", "2026-01-31"],
  ["2026-01-31", "dmy", "2026-01-31"], ["31-Jan-2026", "dmy", "2026-01-31"],
  ["1 February 2026", "dmy", "2026-02-01"], ["03/04/2026", "dmy", "2026-04-03"],
  ["03/04/2026", "mdy", "2026-03-04"], ["25/12/26", "dmy", "2026-12-25"],
  ["lixo", "dmy", null],
  // dia > 12 desmente o estilo declarado
  ["25/03/2026", "mdy", "2026-03-25"],
];
for (const [input, style, expected] of D) {
  const got = B.parseDate(input, style);
  ok(got === expected, `parseDate(${JSON.stringify(input)}, ${style}) = ${expected}`, got);
}

// ------------------------------------------------- formatos de banco
const FORMATOS = {
  "irlandes debito/credito": [
    ["Date", "Description", "Debit", "Credit", "Balance"],
    ["02/01/2026", "TESCO STORES DUBLIN", "45.20", "", "954.80"],
    ["05/01/2026", "SALARY ACME LTD", "", "2500.00", "3454.80"],
    ["07/01/2026", "ESB ENERGY DD", "88.10", "", "3366.70"],
  ],
  "valor unico com sinal": [
    ["Date", "Details", "Amount", "Balance"],
    ["02/01/2026", "TESCO STORES", "-45.20", "954.80"],
    ["05/01/2026", "SALARY", "2500.00", "3454.80"],
  ],
  "virgula decimal europeia": [
    ["Data", "Descricao", "Valor", "Saldo"],
    ["02/01/2026", "SUPERMERCADO", "-45,20", "954,80"],
    ["05/01/2026", "SALARIO", "2.500,00", "3.454,80"],
  ],
  "com preambulo antes do cabecalho": [
    ["Allied Irish Banks"], ["Account: 12345678"], ["Period: 01/01/2026 - 31/01/2026"], [],
    ["Date", "Description", "Debit", "Credit", "Balance"],
    ["02/01/2026", "TESCO", "45.20", "", "954.80"],
    ["05/01/2026", "SALARY", "", "2500.00", "3454.80"],
  ],
  "sem cabecalho": [
    ["02/01/2026", "TESCO STORES", "-45.20", "954.80"],
    ["05/01/2026", "SALARY ACME", "2500.00", "3454.80"],
    ["07/01/2026", "ESB ENERGY", "-88.10", "3366.70"],
  ],
  "parenteses para negativo": [
    ["Date", "Narrative", "Amount"],
    ["02/01/2026", "TESCO", "(45.20)"],
    ["05/01/2026", "SALARY", "2500.00"],
  ],
};

for (const [nome, rows] of Object.entries(FORMATOS)) {
  console.log(`\n== formato: ${nome} ==`);
  const det = B.detectLayout(rows);
  const { lines, problems } = B.buildLines(rows, det.mapping);
  ok(lines.length >= 2, `leu as linhas (${lines.length})`, { problems, mapping: det.mapping });
  const saida = lines.find((l) => l.amount < 0);
  const entrada = lines.find((l) => l.amount > 0);
  ok(!!saida && Math.abs(saida.amount + 45.2) < 0.011, "saida ficou negativa (-45,20)", saida);
  ok(!!entrada && Math.abs(entrada.amount - 2500) < 0.011, "entrada ficou positiva (+2500)", entrada);
  ok(lines[0].line_date === "2026-01-02", "primeira data = 2026-01-02", lines[0].line_date);
  ok(problems.length === 0, "sem linhas problematicas", problems);
}

// ------------------------------------------------- repeticao legitima
console.log("\n== dois cafes iguais no mesmo dia NAO sao duplicata ==");
const cafes = [
  ["Date", "Description", "Amount"],
  ["02/01/2026", "CAFE NERO", "-4.50"],
  ["02/01/2026", "CAFE NERO", "-4.50"],
];
const c1 = B.buildLines(cafes, B.detectLayout(cafes).mapping);
ok(c1.lines.length === 2, "duas linhas lidas", c1.lines.length);
ok(c1.lines[0].dedupe_key !== c1.lines[1].dedupe_key, "chaves diferentes entre si");

console.log("\n== reimportar o MESMO arquivo gera as MESMAS chaves ==");
const c2 = B.buildLines(cafes, B.detectLayout(cafes).mapping);
ok(c1.lines[0].dedupe_key === c2.lines[0].dedupe_key, "chave 1 estavel");
ok(c1.lines[1].dedupe_key === c2.lines[1].dedupe_key, "chave 2 estavel");

console.log("\n== periodo sobreposto: linhas antigas repetem chave, nova e diferente ==");
const jan_fev = [
  ["Date", "Description", "Amount"],
  ["02/01/2026", "CAFE NERO", "-4.50"],
  ["02/01/2026", "CAFE NERO", "-4.50"],
  ["03/02/2026", "CAFE NERO", "-4.50"],
];
const c3 = B.buildLines(jan_fev, B.detectLayout(jan_fev).mapping);
ok(c3.lines[0].dedupe_key === c1.lines[0].dedupe_key, "linha ja importada tem a mesma chave");
ok(c3.lines[1].dedupe_key === c1.lines[1].dedupe_key, "segunda tambem");
ok(!c1.lines.some((l) => l.dedupe_key === c3.lines[2].dedupe_key), "linha nova tem chave inedita");

// ------------------------------------------------- conferencia de saldo
console.log("\n== conferencia contra o saldo do proprio arquivo ==");
const bom = B.buildLines(FORMATOS["irlandes debito/credito"], B.detectLayout(FORMATOS["irlandes debito/credito"]).mapping);
ok(B.checkAgainstBalance(bom.lines) === null, "extrato coerente nao acusa nada");

const sinalTrocado = bom.lines.map((l) => ({ ...l, amount: Math.abs(l.amount) }));
ok(B.checkAgainstBalance(sinalTrocado) !== null, "sinal errado E DETECTADO", B.checkAgainstBalance(sinalTrocado));

// ------------------------------------------------- linhas ruins
console.log("\n== lixo no arquivo ==");
const sujo = [
  ["Date", "Description", "Amount"],
  ["02/01/2026", "TESCO", "-45.20"],
  ["", "", ""],
  ["data invalida", "ALGO", "-10.00"],
  ["05/01/2026", "SALARY", "nao e numero"],
  ["TOTAL", "", "-55.20"],
];
const s = B.buildLines(sujo, B.detectLayout(sujo).mapping);
ok(s.lines.length === 1, "so a linha boa entrou", s.lines.length);
ok(s.problems.length === 2, "duas linhas com DEFEITO reportadas", s.problems);
ok(s.problems[0].row === 4, "aponta o numero da linha no arquivo", s.problems);
ok(s.summaryRows.length === 1 && s.summaryRows[0] === 6, "linha TOTAL contada a parte, nao como defeito", s.summaryRows);

console.log("\n== outras formas de linha de totalizacao ==");
for (const rotulo of ["TOTAL", "Closing Balance", "Saldo final", "Carried forward"]) {
  const rows = [["Date","Description","Amount"],["02/01/2026","TESCO","-45.20"],[rotulo,"","-45.20"]];
  const r = B.buildLines(rows, B.detectLayout(rows).mapping);
  ok(r.problems.length === 0 && r.summaryRows.length === 1, `"${rotulo}" reconhecida como totalizacao`, {p:r.problems,s:r.summaryRows});
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========`);
process.exit(fail ? 1 : 0);
