/**
 * A espera por cota tem TETO — teste.
 *
 * Existe por um defeito real: a espera do 429 foi escrita por modelo, e a
 * cascata tem cinco. Com a cota estourada em todos, uma leitura passou 3,5
 * minutos parada em vez de desistir em trinta segundos — e na tela isso não
 * parece lentidão, parece que travou.
 *
 * O orçamento é da LEITURA INTEIRA. Um teste por modelo não pegaria isso: cada
 * espera, sozinha, estava dentro do limite. O que estourou foi a soma.
 */
const { waitDecision, retryDelayMs, WAIT_BUDGET_MS } = require("../.test-build/extractor/quotaWait");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

// O erro real do Google, encurtado.
const quotaErr = (seconds) => new Error(
  `[GoogleGenerativeAI Error]: [429 Too Many Requests] You exceeded your current quota. ` +
  `[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"${seconds}s"}]`
);

console.log("\n== o tempo pedido pelo Google e lido do erro ==");
ok(retryDelayMs(quotaErr("38")) === 38000, "38s viram 38000ms", retryDelayMs(quotaErr("38")));
ok(retryDelayMs(quotaErr("38.612157394")) === 38613, "fracao arredonda para cima", retryDelayMs(quotaErr("38.612157394")));
ok(retryDelayMs(new Error("500 Internal Server Error")) === null, "erro sem cota nao pede espera");
ok(retryDelayMs(null) === null, "erro nulo nao quebra");

console.log("\n== a primeira espera cabe no orcamento ==");
ok(waitDecision(quotaErr("29"), 0) === 29000, "29s com orcamento inteiro: espera", waitDecision(quotaErr("29"), 0));

console.log("\n== a SOMA e o que decide, nao cada espera sozinha ==");
// O defeito: 29s + 29s + 29s + 29s + 29s = 145s, e cada um "cabia" em 60s.
ok(waitDecision(quotaErr("29"), 29000) === null,
  "segunda espera de 29s ja nao cabe (29+29 > 40s de orcamento)", waitDecision(quotaErr("29"), 29000));
ok(waitDecision(quotaErr("10"), 29000) === 10000,
  "mas uma espera CURTA ainda cabe depois de uma longa", waitDecision(quotaErr("10"), 29000));
ok(waitDecision(quotaErr("10"), 35000) === null,
  "e para de caber quando o orcamento acaba", waitDecision(quotaErr("10"), 35000));

console.log("\n== o teto nunca e ultrapassado, somando toda a cascata ==");
// Simula a cascata inteira pedindo o maximo possivel a cada passo.
let waited = 0;
for (let i = 0; i < 10; i++) {
  const d = waitDecision(quotaErr("39"), waited);
  if (d === null) break;
  waited += d;
}
ok(waited <= WAIT_BUDGET_MS, `esperou ${waited}ms, dentro do teto de ${WAIT_BUDGET_MS}ms`, waited);

// O caso exato do defeito: cinco modelos, 29s cada.
waited = 0;
for (let i = 0; i < 5; i++) {
  const d = waitDecision(quotaErr("29"), waited);
  if (d === null) continue;
  waited += d;
}
ok(waited <= WAIT_BUDGET_MS,
  `cinco modelos a 29s somam ${waited}ms, nao os 145000ms do defeito`, waited);

console.log("\n== espera unica gigante e recusada de saida ==");
ok(waitDecision(quotaErr("600"), 0) === null,
  "10 minutos nao viram espera: falha rapido em vez de travar a tela");

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========`);
process.exit(fail ? 1 : 0);
