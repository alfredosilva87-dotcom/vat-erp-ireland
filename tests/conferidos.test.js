/**
 * O VAT3 CONTA SÓ O QUE FOI CONFERIDO — teste.
 *
 * Reproduz o caso medido em produção, com os números medidos: três vendas
 * gravadas, uma conferida. O razão dizia € 230,00 e o ecrã de IVA dizia
 * € 115,00 para o mesmo período — e era o 115 que ia no ficheiro entregue à
 * Revenue, marcado `Open`.
 *
 * O teste central é o do fim: **o que a declaração conta tem de bater com o
 * razão**. Os outros existem para a regra não se desfazer aos poucos.
 */
const {
  contaParaDeclaracao, apenasConferidos, pendentes, resumoPendentes,
} = require("../.test-build/fiscal/conferidos");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

// As três vendas do teste de ponta a ponta, tal e qual.
const VENDAS = [
  { doc: "ZZS-0001", net: 1000, vat: 230, reviewed_at: "2026-09-03T14:21:00Z" }, // conferida e contabilizada
  { doc: "ZZS-0002", net: -500, vat: -115, reviewed_at: null },                  // engano: negativo
  { doc: "ZZS-0003", net: 0, vat: 0, reviewed_at: null },                        // engano: `abc` virou zero
];
const RAZAO_845 = 230; // o que o razão tinha, medido no balancete

console.log("\n== um documento so conta depois de alguem o conferir ==");
ok(contaParaDeclaracao(VENDAS[0]) === true, "conferida conta");
ok(contaParaDeclaracao(VENDAS[1]) === false, "por conferir nao conta");
ok(contaParaDeclaracao({ reviewed_at: "" }) === false, "string vazia nao e conferencia");
ok(contaParaDeclaracao({ reviewed_at: undefined }) === false, "undefined explicito nao e conferencia");

console.log("\n== coluna nao pedida na consulta conta, de proposito ==");
// Uma consulta que ainda nao conhece a regra nao pode fazer sumir documentos
// legitimos em silencio. O erro preferido aqui e o visivel.
ok(contaParaDeclaracao({ net: 100 }) === true, "objecto sem a coluna e tratado como conferido");

console.log("\n== O CASO REAL: a declaracao passa a bater com o razao ==");
{
  const contados = apenasConferidos(VENDAS);
  const vatDeclarado = contados.reduce((a, v) => a + v.vat, 0);
  ok(contados.length === 1, "de 3 documentos, 1 conta", contados.length);
  ok(vatDeclarado === 230, "a declaracao passa a dizer 230, nao 115", vatDeclarado);
  ok(vatDeclarado === RAZAO_845,
    "E ESTE E O TESTE: declaracao e razao dao o MESMO numero",
    { declaracao: vatDeclarado, razao: RAZAO_845 });
}

console.log("\n== o antes, para nao haver duvida de que o teste morde ==");
{
  // Como era: somava as tres, e o negativo abatia ao bom.
  const comoEra = VENDAS.reduce((a, v) => a + v.vat, 0);
  ok(comoEra === 115, "somar tudo dava mesmo os 115 do relatorio", comoEra);
  ok(comoEra !== RAZAO_845, "e nao batia com o razao");
}

console.log("\n== o que ficou de fora e dito, com tamanho ==");
{
  const r = resumoPendentes(VENDAS, (v) => v.vat);
  ok(r.count === 2, "dois documentos por conferir", r);
  ok(r.vat === -115, "que movem -115 de IVA — o aviso diz o tamanho do buraco", r);
  ok(pendentes(VENDAS).map((v) => v.doc).join(",") === "ZZS-0002,ZZS-0003",
    "e diz quais sao", pendentes(VENDAS).map((v) => v.doc));
}

console.log("\n== periodo limpo: nenhum aviso ==");
{
  const todasConferidas = VENDAS.map((v) => ({ ...v, reviewed_at: "2026-09-03T00:00:00Z" }));
  const r = resumoPendentes(todasConferidas, (v) => v.vat);
  ok(r.count === 0 && r.vat === 0, "sem pendentes, o resumo e zero e o ecra nao grita", r);
  ok(apenasConferidos(todasConferidas).length === 3, "e as tres contam");
}

console.log("\n== lista vazia nao rebenta ==");
ok(apenasConferidos([]).length === 0 && resumoPendentes([], () => 0).count === 0, "periodo sem documentos");

console.log(`\n${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
