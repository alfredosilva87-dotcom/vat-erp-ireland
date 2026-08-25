/**
 * Esperar a cota do Gemini, e por quanto tempo — a decisão, sem rede.
 *
 * Arquivo próprio pelo mesmo motivo de `lib/phoneIntake.ts`: é regra que
 * precisa de teste, e o resto de `gemini.ts` só existe com o SDK do Google
 * carregado. Aqui não há import nenhum, então o teste roda direto.
 *
 * O defeito que originou isto: a espera do 429 estava escrita POR MODELO, e a
 * cascata tem cinco. Com a cota estourada em todos, uma leitura passou 3,5
 * minutos parada em vez de desistir em trinta segundos — e uma tela parada por
 * três minutos não parece lentidão, parece que travou.
 */

/**
 * Quanto uma leitura pode passar PARADA esperando cota, no total.
 *
 * É orçamento da leitura INTEIRA, não de cada tentativa: um teto por modelo
 * vira cinco vezes o teto quando todos estão sem cota, que foi exatamente o
 * defeito. Espera longa demais é pior que erro — no erro o analista sabe que
 * precisa tentar de novo; na espera ele só olha.
 */
export const WAIT_BUDGET_MS = 40_000;

/**
 * O tempo que o Google pediu, lido do próprio erro.
 *
 * O 429 vem com `"retryDelay":"38s"` no corpo. Usar o número dele em vez de um
 * palpite é o que faz a segunda tentativa valer a pena: esperar menos volta a
 * bater no limite, esperar mais é tempo jogado fora.
 *
 * `null` quando não é erro de cota — nesse caso não há o que esperar.
 */
export function retryDelayMs(err: unknown): number | null {
  const msg = String((err as any)?.message ?? err ?? "");
  const m = msg.match(/"retryDelay":"(\d+(?:\.\d+)?)s"/);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
}

/**
 * Esperar por este erro, e quanto?
 *
 * `null` = não espera. Ou não é erro de cota, ou o tempo pedido não cabe no
 * que sobrou do orçamento — e aí o certo é ir ao próximo modelo da cascata,
 * que tem cota própria, em vez de dormir por nada.
 */
export function waitDecision(err: unknown, alreadyWaitedMs: number): number | null {
  const asked = retryDelayMs(err);
  if (asked === null) return null;
  const left = WAIT_BUDGET_MS - alreadyWaitedMs;
  return asked <= left ? asked : null;
}
