/**
 * O semaforo das obrigacoes — testes.
 *
 * A fronteira entre cores e o que decide se alguem muda o que ia fazer hoje.
 * Errar um dia numa comparacao faz uma obrigacao que vence amanha aparecer
 * como "esta na agenda", e o erro so se descobre depois do prazo.
 *
 * Por isso os testes batem EXACTAMENTE nas fronteiras: 0, 7, 8, 30, 31.
 */
const A = require("../.test-build/fiscal/agenda.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const HOJE = "2026-08-27";
const obg = (venc, entregue = false) => ({
  id: "x", clientId: "c1", tipo: "VAT3", periodo: "2026/07-08",
  vencimento: venc, entregue,
});

console.log("\n== dias entre datas ==");
ok(A.diasEntre("2026-08-27", "2026-08-27") === 0, "mesmo dia = 0");
ok(A.diasEntre("2026-08-27", "2026-09-03") === 7, "uma semana = 7");
ok(A.diasEntre("2026-08-27", "2026-08-20") === -7, "sete dias atras = -7");
// Fim de mes e ano bissexto: onde a aritmetica de datas costuma partir.
ok(A.diasEntre("2026-02-28", "2026-03-01") === 1, "28/02 para 01/03 em ano normal = 1");
ok(A.diasEntre("2024-02-28", "2024-03-01") === 2, "28/02 para 01/03 em ano bissexto = 2");
ok(A.diasEntre("2026-12-31", "2027-01-01") === 1, "atravessa o ano");

console.log("\n== as fronteiras do semaforo ==");
ok(A.classificar(obg("2026-08-26"), HOJE).semaforo === "vermelho", "ontem = vermelho");
ok(A.classificar(obg("2026-08-27"), HOJE).semaforo === "laranja", "HOJE ainda e laranja, nao vermelho");
ok(A.classificar(obg("2026-09-03"), HOJE).semaforo === "laranja", "exactamente 7 dias = laranja");
ok(A.classificar(obg("2026-09-04"), HOJE).semaforo === "amarelo", "8 dias ja e amarelo");
ok(A.classificar(obg("2026-09-26"), HOJE).semaforo === "amarelo", "exactamente 30 dias = amarelo");
ok(A.classificar(obg("2026-09-27"), HOJE).semaforo === "verde", "31 dias = verde");

console.log("\n== os dois casos que nao sao prazo ==");
{
  // Entregue com atraso continua verde: o painel diz o que HA PARA FAZER, e o
  // que ja foi feito nao e trabalho.
  const c = A.classificar(obg("2026-01-15", true), HOJE);
  ok(c.semaforo === "verde", "entregue com atraso continua verde", c);
}
{
  // Sem vencimento e AMARELO e nao verde: e cadastro por completar, e verde
  // esconderia isso para sempre.
  const c = A.classificar(obg(null), HOJE);
  ok(c.semaforo === "amarelo" && c.diasAteVencer === null, "sem vencimento = amarelo", c);
}

console.log("\n== o painel ordena pela urgencia ==");
{
  const clientes = [
    { id: "a", code: "C-A", name: "Alfa" },
    { id: "b", code: "C-B", name: "Beta" },
    { id: "c", code: "C-C", name: "Gama" },
  ];
  const obgs = [
    { id: "1", clientId: "b", tipo: "VAT3", periodo: null, vencimento: "2026-08-01", entregue: false },
    { id: "2", clientId: "b", tipo: "RTD", periodo: null, vencimento: "2026-07-01", entregue: false },
    { id: "3", clientId: "a", tipo: "VAT3", periodo: null, vencimento: "2026-08-30", entregue: false },
    { id: "4", clientId: "c", tipo: "VAT3", periodo: null, vencimento: "2026-12-01", entregue: false },
    { id: "5", clientId: "c", tipo: "RTD", periodo: null, vencimento: "2026-01-01", entregue: true },
  ];
  const p = A.montarPainel(clientes, obgs, HOJE);
  ok(p[0].clientId === "b", "o cliente com atraso vem primeiro", p.map((x) => x.clientId));
  ok(p[0].atrasadas === 2, "e conta as duas atrasadas", p[0]);
  ok(p[0].pendentes[0].vencimento === "2026-07-01", "dentro dele, a mais antiga primeiro", p[0].pendentes[0]);
  ok(p[1].clientId === "a" && p[1].semaforo === "laranja", "depois o que vence em 3 dias", p[1]);
  ok(p[2].clientId === "c" && p[2].semaforo === "verde", "e o que esta em dia por ultimo", p[2]);
  ok(p[2].entregues === 1, "a entregue conta como entregue e nao como pendente", p[2]);

  const r = A.resumo(p);
  ok(r.comAtraso === 1 && r.obrigacoesAtrasadas === 2, "o resumo do topo", r);
  ok(r.clientes === 3, "cliente sem obrigacao nenhuma continua na conta", r);
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail === 0 ? 0 : 1);
