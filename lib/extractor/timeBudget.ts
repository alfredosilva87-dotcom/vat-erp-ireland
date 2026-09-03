/**
 * O RELÓGIO QUE FALTAVA À LEITURA.
 *
 * A leitura de um PDF com camada de texto podia fazer DUAS chamadas ao Gemini
 * em sequência — estruturar o texto e, se o score não chegasse ao limiar,
 * escalar para visão com o PDF inteiro em base64. A decisão de escalar olhava
 * só para a QUALIDADE do resultado e nunca para o tempo já gasto, dentro de um
 * pedido HTTP com orçamento fixo. O resultado observado em produção foi 504: o
 * utilizador esperava ~50 s e recebia a palavra "Error", sem leitura nenhuma.
 *
 * O que este módulo faz é simples e é a única coisa que faz: guarda o instante
 * em que o pedido começou e responde a uma pergunta — *ainda cabe uma chamada
 * que costuma custar X?*. Quem pergunta decide o que fazer com a resposta.
 *
 * A regra de negócio por trás: **mais vale uma leitura fraca marcada "conferir"
 * do que nada ao fim de 60 s**. Uma leitura fraca o contabilista corrige em
 * segundos, porque tem os campos preenchidos à frente; de um 504 não se
 * aproveita nada, e o documento fica de fora do sistema.
 */

/** Quanto costuma custar uma leitura por visão (PDF inteiro em base64). */
export const VISION_COST_MS = 25_000;

/** Quanto costuma custar detectar fronteiras de lote num PDF de várias páginas. */
export const BOUNDARY_COST_MS = 15_000;

/**
 * Folga que nunca se gasta em chamadas ao modelo.
 *
 * Não é superstição: depois da última chamada ainda há a categorização de
 * itens, a montagem da resposta e a serialização do JSON — e um 504 a essa
 * altura deitava fora trabalho já pago.
 */
export const SAFETY_MS = 8_000;

export interface TimeBudget {
  /** Instante (epoch ms) a partir do qual não se começa mais nada. */
  readonly deadline: number;
}

/**
 * Abre um orçamento a partir do instante de início e do tecto do pedido.
 *
 * `maxDurationMs` é o mesmo número que o `export const maxDuration` da rota,
 * em milissegundos — passá-lo explicitamente evita que os dois se separem sem
 * ninguém dar por isso.
 */
export function openBudget(startedAt: number, maxDurationMs: number, safetyMs = SAFETY_MS): TimeBudget {
  return { deadline: startedAt + Math.max(0, maxDurationMs - safetyMs) };
}

/** Quanto resta, nunca negativo. */
export function remainingMs(budget: TimeBudget, now: number): number {
  return Math.max(0, budget.deadline - now);
}

/**
 * Cabe ainda uma chamada que costuma custar `costMs`?
 *
 * Sem orçamento (`undefined`) a resposta é sempre sim — o caminho de fora do
 * HTTP (script, teste, fila de fundo) não tem por que ser cortado.
 */
export function hasRoomFor(budget: TimeBudget | undefined, now: number, costMs: number): boolean {
  if (!budget) return true;
  return remainingMs(budget, now) >= costMs;
}
