/**
 * A ROTINA DE FECHAMENTO — a politica, testada sem banco.
 *
 * O que se guarda aqui e a decisao "da para fechar?". Ela e o unico sitio do
 * fecho que se consegue testar sem Postgres, e e tambem a que, se errar,
 * erra em silencio: um fecho que devia ser recusado e nao foi so aparece
 * meses depois, num numero que mudou dentro de um mes trancado.
 */
const F = require("../.test-build/accounting/fechamentoPuro.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

console.log("\n== o que impede e o que so avisa ==");
{
  const limpo = [
    F.verificacao("porConferir", 0),
    F.verificacao("vatDivergente", 0),
    F.verificacao("controloPagar", 0),
  ];
  ok(F.podeFechar(limpo), "tudo a zero fecha");

  // Documento por conferir muda o DRE quando alguem o conferir: o numero
  // ainda vai mexer, e travar um numero que vai mexer e travar o errado.
  ok(!F.podeFechar([F.verificacao("porConferir", 3)]), "documento por conferir impede");
  ok(!F.podeFechar([F.verificacao("vatDivergente", -12.4)]), "IVA divergente impede");
  ok(!F.podeFechar([F.verificacao("meiasIntegracoes", 1)]), "meia integracao impede");
  ok(!F.podeFechar([F.verificacao("razaoDesbalanceado", 0.5)]), "balanco que nao fecha impede");

  // A diferenca na conta de controlo pode ser abertura por detalhar — o
  // proprio control.ts diz que nao e necessariamente erro. Fecha, e fica
  // registada.
  ok(F.podeFechar([F.verificacao("controloPagar", 6300)]), "diferenca no controlo avisa, nao impede");
  ok(F.podeFechar([F.verificacao("bancoPorFechar", 2)]), "banco por conciliar avisa");

  // Sem isto ninguem fecharia o primeiro mes da vida do cliente, e sem o
  // primeiro nao ha segundo.
  ok(F.podeFechar([F.verificacao("mesAnteriorAberto", 1)]), "mes anterior aberto avisa");
}

console.log("\n== o sinal nao salva ninguem ==");
{
  // Uma divergencia de -12,40 e tao divergencia como uma de +12,40. Comparar
  // sem valor absoluto deixaria passar metade delas.
  ok(F.impedimentos([F.verificacao("vatDivergente", -12.4)]).length === 1, "negativo tambem impede");
  ok(F.impedimentos([F.verificacao("vatDivergente", 0.001)]).length === 0,
     "um milesimo nao e divergencia (arredondamento)");
}

console.log("\n== os meses de um intervalo ==");
{
  const m = F.mesesEntre("2026-01-01", "2026-03-31");
  ok(m.length === 3, "janeiro a marco sao tres meses", m.length);
  ok(m[1].de === "2026-02-01" && m[1].ate === "2026-02-28", "fevereiro comum", m[1]);

  // O dia 0 do mes seguinte e o unico calculo que nao erra em ano bissexto.
  ok(F.limitesDoMes(2028, 2).ate === "2028-02-29", "fevereiro bissexto", F.limitesDoMes(2028, 2));
  ok(F.limitesDoMes(2026, 12).ate === "2026-12-31", "dezembro");

  // Um intervalo invertido nao pode girar para sempre no servidor.
  ok(F.mesesEntre("2026-05-01", "2026-01-31").length === 0, "intervalo invertido nao gira");
}

console.log("\n== qual mes falta fechar ==");
{
  const fechados = [
    { periodStart: "2026-01-01", periodEnd: "2026-01-31" },
    { periodStart: "2026-02-01", periodEnd: "2026-02-28" },
  ];
  ok(F.primeiroMesAberto("2026-01-01", "2026-02-28", fechados) === null, "jan-fev estao fechados");
  ok(F.primeiroMesAberto("2026-01-01", "2026-03-31", fechados) === "2026-03", "falta marco",
     F.primeiroMesAberto("2026-01-01", "2026-03-31", fechados));

  // Um fecho que cobre PARTE do mes nao fecha o mes: aceitar isso deixaria um
  // buraco no cadeado do tamanho dos dias que sobram.
  const parcial = [{ periodStart: "2026-03-01", periodEnd: "2026-03-15" }];
  ok(F.primeiroMesAberto("2026-03-01", "2026-03-31", parcial) === "2026-03",
     "meio mes fechado nao fecha o mes");

  ok(F.fechadoAte(fechados) === "2026-02-28", "trancado ate ao fim de fevereiro");
  ok(F.fechadoAte([]) === null, "sem fechos, nada trancado");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
