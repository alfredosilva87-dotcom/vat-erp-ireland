/**
 * Carga de saldos de abertura — testes.
 *
 * O erro mais caro de uma migracao contabil nao e o que rebenta: e o
 * saldo que entra mil vezes maior porque `1.234,56` foi lido como
 * `1234.56` num arquivo que usava ponto de milhar. O balanco continua a
 * fechar, o relatorio sai bonito, e o patrimonio do cliente esta errado
 * por tres casas.
 *
 * Por isso metade destes testes e sobre LER NUMERO. A outra metade e
 * sobre o que fica de fora do de-para, que e onde mora o resto do erro.
 */
const O = require("../.test-build/accounting/opening.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

console.log("\n== ler numero: os formatos que chegam de verdade ==");
{
  const casos = [
    ["1234.56", 1234.56, "ingles simples"],
    ["1,234.56", 1234.56, "ingles com milhar"],
    ["1.234,56", 1234.56, "portugues/irlandes com milhar"],
    ["1234,56", 1234.56, "virgula decimal sem milhar"],
    ["1.234.567,89", 1234567.89, "milhoes, virgula decimal"],
    ["1,234,567.89", 1234567.89, "milhoes, ponto decimal"],
    ["(500,00)", -500, "parenteses e negativo"],
    ["(1,250.00)", -1250, "parenteses com milhar"],
    ["-320.50", -320.5, "sinal de menos"],
    ["€ 1.500,00", 1500, "com simbolo de moeda"],
    ["  250  ", 250, "inteiro com espacos"],
    ["1234", 1234, "sem separador nenhum"],
    ["", 0, "vazio"],
    ["-", 0, "so um traco"],
  ];
  for (const [entrada, esperado, nome] of casos) {
    const lido = O.lerNumero(entrada);
    ok(lido === esperado, `${nome}: "${entrada}" -> ${esperado}`, lido);
  }

  // O caso que separa uma leitura certa de uma errada por mil vezes.
  ok(O.lerNumero("1.234") === 1234, "\"1.234\" sem casas decimais e MIL, nao 1,234", O.lerNumero("1.234"));
  ok(O.lerNumero("1.23") === 1.23, "mas \"1.23\" com duas casas e um e vinte e tres", O.lerNumero("1.23"));
}

console.log("\n== ler o balancete colado ==");
{
  const texto = [
    "Codigo\tNome\tDebito\tCredito",
    "100\tBanco AIB\t12.500,00\t0,00",
    "310\tFornecedores\t0,00\t4.300,00",
    "700\tVendas\t0,00\t20.000,00",
    "600\tRendas\t3.800,00\t0,00",
    "",
    "TOTAL\t\t16.300,00\t24.300,00",
  ].join("\n");
  const { rows, ignored } = O.parseTrialBalance(texto);
  ok(rows.length === 4, "quatro contas lidas", rows.length);
  ok(ignored >= 2, "cabecalho e linha de TOTAL ignorados", ignored);
  ok(rows[0].external_code === "100" && rows[0].debit === 12500, "primeira linha", rows[0]);
  ok(rows[1].credit === 4300, "credito lido", rows[1]);
  ok(rows[0].external_name === "Banco AIB", "o nome vem junto — e o que denuncia de-para errado");
}

console.log("\n== separadores: tab, ponto-e-virgula, e colado da tela ==");
{
  ok(O.parseTrialBalance("100;Banco;1000,00;0,00").rows.length === 1, "ponto e virgula");
  ok(O.parseTrialBalance("100\tBanco\t1000\t0").rows.length === 1, "tabulacao");
  // Copiado da tela do sistema antigo: colunas separadas por espacos.
  const colado = O.parseTrialBalance("100    Banco AIB     1000,00      0,00");
  ok(colado.rows.length === 1 && colado.rows[0].debit === 1000, "colado com espacos", colado.rows[0]);
}

console.log("\n== tres colunas: a ultima e saldo com sinal ==");
{
  const { rows } = O.parseTrialBalance("100\tBanco\t1500,00\n310\tFornecedores\t-4300,00");
  ok(rows[0].debit === 1500 && rows[0].credit === 0, "saldo positivo vira debito", rows[0]);
  ok(rows[1].credit === 4300 && rows[1].debit === 0, "saldo negativo vira credito", rows[1]);
}

console.log("\n== o balancete do cliente fecha? ==");
{
  const { rows } = O.parseTrialBalance([
    "100\tBanco\t12500,00\t0",
    "310\tFornecedores\t0\t4300,00",
    "700\tVendas\t0\t20000,00",
    "600\tRendas\t11800,00\t0",
  ].join("\n"));
  const c = O.conferir(rows);
  ok(c.debit === 24300 && c.credit === 24300, "somas", c);
  ok(c.ok && c.difference === 0, "fecha");

  const torto = O.parseTrialBalance("100\tBanco\t100,00\t0\n310\tFornecedores\t0\t90,00");
  const ct = O.conferir(torto.rows);
  ok(!ct.ok && ct.difference === 10, "e quando nao fecha, diz de quanto", ct);
}

console.log("\n== de-para: o que fica de fora e o que interessa ==");
{
  const { rows } = O.parseTrialBalance([
    "100\tBanco\t12500,00\t0",
    "310\tFornecedores\t0\t4300,00",
    "999\tConta que ninguem mapeou\t50,00\t0",
  ].join("\n"));
  const mapa = { "100": "1100", "310": "2100" };
  const r = O.applyMapping(rows, mapa);
  ok(r.mapped.length === 2, "duas mapeadas", r.mapped.length);
  ok(r.unmapped.length === 1 && r.unmapped[0].external_code === "999",
     "a nao mapeada aparece, com codigo e nome", r.unmapped[0]);
  ok(r.mapped[0].account_code === "1100", "e leva a conta de destino");
}

console.log("\n== duas contas do cliente na MESMA conta nossa ==");
{
  const mapped = [
    { external_code: "600", external_name: "Renda escritorio", debit: 1000, credit: 0, line: 1, account_code: "6100" },
    { external_code: "601", external_name: "Renda armazem",    debit: 500,  credit: 0, line: 2, account_code: "6100" },
  ];
  const linhas = O.toOpeningLines(mapped);
  ok(linhas.length === 1, "viram UMA partida", linhas.length);
  ok(linhas[0].debit === 1500, "com o valor somado", linhas[0]);
}

console.log("\n== debito e credito na mesma conta somam pelo LIQUIDO ==");
{
  const mapped = [
    { external_code: "100", external_name: "Banco", debit: 1000, credit: 0,   line: 1, account_code: "1100" },
    { external_code: "101", external_name: "Banco", debit: 0,    credit: 300, line: 2, account_code: "1100" },
  ];
  const linhas = O.toOpeningLines(mapped);
  ok(linhas.length === 1 && linhas[0].debit === 700 && linhas[0].credit === 0,
     "700 devedora, e nao duas partidas que se anulam em parte", linhas[0]);
}

console.log("\n== conta que zera nao entra no razao ==");
{
  const mapped = [
    { external_code: "100", external_name: "X", debit: 500, credit: 0,   line: 1, account_code: "1100" },
    { external_code: "101", external_name: "Y", debit: 0,   credit: 500, line: 2, account_code: "1100" },
  ];
  ok(O.toOpeningLines(mapped).length === 0, "saldo liquido zero nao vira partida");
}

console.log("\n== o lancamento de abertura fecha ==");
{
  const { rows } = O.parseTrialBalance([
    "100\tBanco\t12500,00\t0",
    "150\tImobilizado\t8000,00\t0",
    "310\tFornecedores\t0\t4300,00",
    "500\tCapital\t0\t100,00",
    "590\tLucros acumulados\t0\t16100,00",
  ].join("\n"));
  const mapa = { "100": "1100", "150": "1600", "310": "2100", "500": "3100", "590": "3200" };
  const { mapped, unmapped } = O.applyMapping(rows, mapa);
  ok(unmapped.length === 0, "tudo mapeado");
  const linhas = O.toOpeningLines(mapped);
  const d = linhas.reduce((s, l) => s + l.debit, 0);
  const c = linhas.reduce((s, l) => s + l.credit, 0);
  ok(Math.round(d * 100) === Math.round(c * 100), "as partidas fecham", { d, c });
  ok(d === 20500, "e no valor do balancete", d);
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail === 0 ? 0 : 1);
