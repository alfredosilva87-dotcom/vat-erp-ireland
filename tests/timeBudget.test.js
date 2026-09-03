/**
 * A LEITURA TEM RELÓGIO — teste.
 *
 * Nasceu de um defeito visto em produção, não de uma hipótese: `/api/extract`
 * respondia 504 em todas as tentativas. A causa não era lentidão do modelo — era
 * a decisão de ESCALAR para visão olhar só para a qualidade do primeiro
 * resultado e nunca para o tempo já gasto. Com o limiar em 0,85, escalar era o
 * caso comum, e duas chamadas ao Gemini em sequência não cabem no orçamento.
 *
 * O que se testa aqui é a pergunta que faltava: *ainda cabe uma chamada que
 * costuma custar X?*. E testa-se sobretudo o caso que dói — a segunda chamada,
 * quando a primeira já comeu o orçamento.
 */
const {
  openBudget, remainingMs, hasRoomFor,
  VISION_COST_MS, BOUNDARY_COST_MS, SAFETY_MS,
} = require("../.test-build/extractor/timeBudget");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const T0 = 1_000_000; // instante de partida qualquer

console.log("\n== o orcamento guarda folga para o depois da ultima chamada ==");
{
  const b = openBudget(T0, 60_000);
  ok(b.deadline === T0 + 60_000 - SAFETY_MS,
    "60s de rota viram 60s menos a folga", { deadline: b.deadline, esperado: T0 + 60_000 - SAFETY_MS });
  ok(remainingMs(b, T0) === 60_000 - SAFETY_MS, "no instante zero resta tudo menos a folga");
}

console.log("\n== a folga nao pode virar orcamento negativo ==");
{
  const b = openBudget(T0, 3_000); // rota mais curta que a propria folga
  ok(b.deadline === T0, "tecto menor que a folga da orcamento zero, nao negativo", b.deadline);
  ok(remainingMs(b, T0 + 5_000) === 0, "passado o prazo, o que resta e zero e nao um negativo");
}

console.log("\n== O CASO QUE DEU 504: a segunda chamada nao cabe ==");
{
  const b = openBudget(T0, 60_000); // prazo em T0+52s
  // A leitura do texto demorou 30s, como acontece num PDF normal.
  const depoisDoTexto = T0 + 30_000;
  ok(hasRoomFor(b, depoisDoTexto, VISION_COST_MS) === false,
    "com 22s de sobra, uma visao de 25s NAO cabe — e era aqui que rebentava",
    { resta: remainingMs(b, depoisDoTexto), custo: VISION_COST_MS });
}

console.log("\n== mas quando cabe, escala na mesma ==");
{
  const b = openBudget(T0, 60_000);
  const leituraRapida = T0 + 8_000; // PDF pequeno, texto limpo
  ok(hasRoomFor(b, leituraRapida, VISION_COST_MS) === true,
    "8s gastos, 44s de sobra: a visao cabe e deve acontecer",
    { resta: remainingMs(b, leituraRapida) });
}

console.log("\n== o tecto maior da rota compra a escalada de volta ==");
{
  // A rota passou de 60s para 300s exactamente para isto.
  const b = openBudget(T0, 300_000);
  ok(hasRoomFor(b, T0 + 30_000, VISION_COST_MS) === true,
    "com 300s, os mesmos 30s gastos deixam a visao acontecer");
}

console.log("\n== o lote: detectar fronteiras e mais barato que a visao ==");
{
  const b = openBudget(T0, 60_000);
  const t = T0 + 40_000; // restam 12s
  ok(hasRoomFor(b, t, BOUNDARY_COST_MS) === false, "12s nao chegam para as fronteiras (15s)");
  ok(hasRoomFor(b, T0 + 30_000, BOUNDARY_COST_MS) === true, "22s chegam para as fronteiras");
  ok(BOUNDARY_COST_MS < VISION_COST_MS, "e a estimativa das fronteiras e mesmo menor que a da visao");
}

console.log("\n== sem orcamento, nada e cortado ==");
{
  // Fila de fundo, script, teste: nao ha pedido HTTP a expirar.
  ok(hasRoomFor(undefined, T0 + 10_000_000, VISION_COST_MS) === true,
    "orcamento ausente nunca recusa — o corte e so do caminho HTTP");
}

console.log("\n== fronteira exacta: cabe por um triz ==");
{
  const b = openBudget(T0, 60_000); // prazo T0+52s
  const t = b.deadline - VISION_COST_MS;
  ok(hasRoomFor(b, t, VISION_COST_MS) === true, "restar exactamente o custo ainda deixa passar");
  ok(hasRoomFor(b, t + 1, VISION_COST_MS) === false, "um milissegundo a menos ja recusa");
}

console.log(`\n${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
