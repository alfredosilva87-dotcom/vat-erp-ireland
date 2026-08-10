/**
 * Leitura de arquivo em grade de celulas — testes.
 *
 * Roda com `npm test`, que compila lib/sheet.ts antes.
 *
 * O caso que motiva quase tudo aqui e o campo com virgula dentro de aspas:
 * "TESCO STORES, DUBLIN". Um split ingenuo por virgula empurra o extrato
 * inteiro uma coluna para o lado, e o erro nao aparece como erro — aparece
 * como valores errados.
 */
const S = require("../.test-build/sheet.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("\n== separadores ==");
ok(eq(S.parseDelimited("a,b,c\n1,2,3"), [["a","b","c"],["1","2","3"]]), "virgula");
ok(eq(S.parseDelimited("a;b;c\n1;2;3"), [["a","b","c"],["1","2","3"]]), "ponto e virgula");
ok(eq(S.parseDelimited("a\tb\n1\t2"), [["a","b"],["1","2"]]), "tabulacao");

console.log("\n== o separador e decidido pelo arquivo, nao pela primeira linha ==");
const comPreambulo = "Statement of account\nDate;Description;Amount\n02/01/2026;TESCO;-45,20";
ok(eq(S.parseDelimited(comPreambulo)[2], ["02/01/2026", "TESCO", "-45,20"]),
  "preambulo sem separador nao engana", S.parseDelimited(comPreambulo));

console.log("\n== aspas ==");
const comVirgula = 'Date,Description,Amount\n02/01/2026,"TESCO STORES, DUBLIN",-45.20';
ok(eq(S.parseDelimited(comVirgula)[1], ["02/01/2026", "TESCO STORES, DUBLIN", "-45.20"]),
  "virgula DENTRO de aspas nao quebra a coluna", S.parseDelimited(comVirgula)[1]);

const aspasDobradas = 'a,b\n1,"diz ""ola"" aqui"';
ok(eq(S.parseDelimited(aspasDobradas)[1], ["1", 'diz "ola" aqui']), "aspas dobradas viram uma so",
  S.parseDelimited(aspasDobradas)[1]);

const quebraDentro = 'a,b\n1,"linha um\nlinha dois"';
ok(S.parseDelimited(quebraDentro).length === 2, "quebra de linha dentro de aspas nao cria linha nova",
  S.parseDelimited(quebraDentro));

console.log("\n== bordas ==");
ok(eq(S.parseDelimited("a,b\n1,\n"), [["a","b"],["1",""]]), "campo final vazio e preservado",
  S.parseDelimited("a,b\n1,\n"));
ok(eq(S.parseDelimited("﻿a,b\n1,2"), [["a","b"],["1","2"]]), "BOM do Excel e descartado");
ok(eq(S.parseDelimited("a,b\r\n1,2"), [["a","b"],["1","2"]]), "fim de linha do Windows");
ok(eq(S.parseDelimited(""), []), "arquivo vazio nao explode");
ok(eq(S.parseDelimited("so uma coluna\noutra"), [["so uma coluna"],["outra"]]),
  "arquivo sem separador nenhum", S.parseDelimited("so uma coluna\noutra"));

console.log("\n== extrato de verdade sobrevive a viagem ==");
const extrato = [
  "Allied Irish Banks",
  "Account: 12345678",
  "Date,Description,Debit,Credit,Balance",
  '02/01/2026,"TESCO STORES, DUBLIN",45.20,,954.80',
  "05/01/2026,SALARY ACME LTD,,2500.00,3454.80",
].join("\n");
const rows = S.parseDelimited(extrato);
ok(rows.length === 5, "cinco linhas", rows.length);
ok(rows[3][2] === "45.20" && rows[3][4] === "954.80", "colunas no lugar apesar da virgula", rows[3]);

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========`);
process.exit(fail ? 1 : 0);
