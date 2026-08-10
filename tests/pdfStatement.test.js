/**
 * Extrato em PDF — testes.
 *
 * Roda com `npm test`, que compila lib/pdfStatement.ts antes.
 *
 * O caso que motiva o arquivo inteiro: num PDF, COLUNA VAZIA DESAPARECE. A
 * linha de saida e a linha de entrada saem com a mesma forma — data, descricao,
 * dois numeros — e nao da para saber pelo formato quem entrou e quem saiu.
 * A resposta esta no saldo corrido do proprio documento.
 */
const P = require("../.test-build/pdfStatement.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

// Extrato tipico de banco irlandes, ja com saldo corrido. Repare que a coluna
// vazia (debito OU credito) simplesmente nao existe no texto.
const AIB = [
  "Allied Irish Banks",
  "Statement of Account",
  "Account: 12345678          Period: 01/01/2026 - 31/01/2026",
  "",
  "Date        Description                     Debit      Credit     Balance",
  "02/01/2026  TESCO STORES, DUBLIN            45.20                 954.80",
  "05/01/2026  SALARY ACME LTD                            2500.00    3454.80",
  "07/01/2026  ESB ENERGY DD                   88.10                 3366.70",
  "Page 1 of 2",
  "19/01/2026  VODAFONE IRELAND                30.00                 3336.70",
  "28/01/2026  INV 2026-014 PAYMENT                       1230.00    4566.70",
].join("\n");

console.log("\n== extrato digital com saldo corrido ==");
let r = P.pdfTextToRows(AIB);
ok(r.rows.length === 5, "cinco movimentos", { linhas: r.rows.length, rows: r.rows });
ok(r.signFromBalance === true, "sinal veio do saldo, nao do layout", r.notes);

const porData = Object.fromEntries(r.rows.map((x) => [x[0], x]));
ok(porData["2026-01-02"][2] === -45.2, "saida ficou negativa", porData["2026-01-02"]);
ok(porData["2026-01-05"][2] === 2500, "entrada ficou positiva", porData["2026-01-05"]);
ok(porData["2026-01-19"][2] === -30, "segunda saida tambem", porData["2026-01-19"]);
ok(porData["2026-01-28"][2] === 1230, "segunda entrada tambem", porData["2026-01-28"]);
ok(porData["2026-01-02"][1] === "TESCO STORES, DUBLIN", "descricao inteira", porData["2026-01-02"][1]);
ok(porData["2026-01-02"][3] === 954.8, "saldo preservado", porData["2026-01-02"]);

console.log("\n== a PRIMEIRA linha, que nao tem saldo anterior ==");
// Regressao: cheguei a deduzir o sinal da primeira linha pelo sinal da segunda,
// o que e so chute. Aqui a primeira e uma ENTRADA seguida de uma SAIDA — quem
// olha a linha de baixo erra. O sinal certo vem da COLUNA em que o valor foi
// impresso, e as linhas de baixo (essas sim conferidas contra o saldo) dizem
// qual coluna e qual.
const primeiraEhEntrada = [
  "Date        Description            Debit      Credit     Balance",
  "02/01/2026  SALARY ACME LTD                   2500.00    3500.00",
  "05/01/2026  TESCO STORES           45.20                 3454.80",
  "07/01/2026  ESB ENERGY DD          88.10                 3366.70",
].join("\n");
r = P.pdfTextToRows(primeiraEhEntrada);
ok(r.signFromBalance === true, "resolveu pelo saldo", r.notes);
ok(r.rows[0][2] === 2500, "primeira linha ficou POSITIVA (esta na coluna de credito)", r.rows[0]);
ok(r.rows[1][2] === -45.2, "segunda continua negativa", r.rows[1]);

const primeiraEhSaida = [
  "Date        Description            Debit      Credit     Balance",
  "02/01/2026  TESCO STORES           45.20                 954.80",
  "05/01/2026  SALARY ACME LTD                   2500.00    3454.80",
].join("\n");
r = P.pdfTextToRows(primeiraEhSaida);
ok(r.rows[0][2] === -45.2, "e o espelho: primeira na coluna de debito fica negativa", r.rows[0]);

console.log("\n== ruido de PDF nao vira movimento ==");
r = P.pdfTextToRows(AIB);
ok(r.ignored >= 3, "cabecalho, rodape e preambulo ignorados", r.ignored);
ok(!r.rows.some((x) => String(x[1]).toLowerCase().includes("page")), "rodape de pagina fora");

console.log("\n== descricao quebrada em duas linhas ==");
const quebrado = [
  "02/01/2026  TESCO STORES                    45.20                 954.80",
  "            UNIT 4 DUBLIN 2",
  "05/01/2026  SALARY                                     2500.00    3454.80",
].join("\n");
r = P.pdfTextToRows(quebrado);
ok(r.rows.length === 2, "continuacao nao virou linha nova", r.rows);
ok(String(r.rows[0][1]).includes("UNIT 4"), "continuacao entrou na descricao", r.rows[0][1]);

console.log("\n== valor com virgula decimal europeia ==");
const europeu = [
  "02/02/2026  PAGAMENTO FORNECEDOR          1.234,56              8.765,44",
  "05/02/2026  RECEBIMENTO CLIENTE                       2.500,00  11.265,44",
].join("\n");
r = P.pdfTextToRows(europeu);
ok(r.rows.length === 2, "duas linhas", r.rows);
ok(r.rows[1][2] === 2500, "entrada de 2.500,00 lida certo", r.rows[1]);

console.log("\n== sem saldo corrido: devolve as colunas para o contador decidir ==");
const semSaldo = [
  "02/01/2026  TESCO STORES     -45.20",
  "05/01/2026  SALARY          2500.00",
].join("\n");
r = P.pdfTextToRows(semSaldo);
ok(r.signFromBalance === false, "nao finge que deduziu");
ok(r.rows.length === 2 && r.rows[0][2] === -45.2, "numeros preservados como vieram", r.rows);

console.log("\n== saldo que NAO fecha nao e usado como verdade ==");
const saldoQuebrado = [
  "02/01/2026  UM        10.00     100.00",
  "05/01/2026  DOIS      20.00     999.99",
  "07/01/2026  TRES      30.00     123.45",
].join("\n");
r = P.pdfTextToRows(saldoQuebrado);
ok(r.signFromBalance === false, "coincidencia solta nao vira saldo corrido", r.notes);

console.log("\n== texto sem extrato nenhum ==");
r = P.pdfTextToRows("Contrato de prestacao de servicos\nClausula primeira");
ok(r.rows.length === 0, "nao inventa movimento", r.rows);
ok(r.notes.length > 0, "e diz que nao achou nada", r.notes);

console.log("\n== datas em formatos diferentes ==");
for (const [linha, esperado] of [
  ["31-Jan-2026  ALGO   10.00   90.00", "2026-01-31"],
  ["2026-01-31   ALGO   10.00   90.00", "2026-01-31"],
]) {
  const rr = P.pdfTextToRows(linha + "\n01-Feb-2026  OUTRO  10.00  80.00");
  ok(rr.rows.length === 2 && rr.rows[0][0] === esperado, `"${linha.slice(0, 12)}" reconhecida`, rr.rows[0]);
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========`);
process.exit(fail ? 1 : 0);
