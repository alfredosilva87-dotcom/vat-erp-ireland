/**
 * O QUE SE ESCREVE NUMA CÉLULA DO LIVRO DE HORAS.
 *
 * ---------------------------------------------------------------------------
 * PORQUE ISTO SAIU DA ROTA PARA UM MÓDULO PRÓPRIO
 *
 * A primeira versão vivia dentro do `PUT` e devolvia `null` para um campo em
 * branco. Só que `hours`, `sunday_hours`, `holiday_hours` e `week_worked` são
 * **not null** na base, com padrão 0/false: um nulo explícito não gravava
 * "vazio" — fazia o Postgres recusar o `upsert` inteiro. Quem apagasse o
 * domingo de uma semana perdia também as horas normais que tinha acabado de
 * escrever, e via uma mensagem de base de dados em vez de uma frase.
 *
 * Passou nos testes todos porque não havia teste nenhum: a função estava presa
 * dentro de uma rota, e as rotas só se exercitam com base. Aqui exercita-se
 * sozinha.
 *
 * ---------------------------------------------------------------------------
 * AS DUAS DECISÕES QUE ESTE MÓDULO GUARDA
 *
 * 1. **Dentro de uma linha que existe, vazio é ZERO.** "Não fez domingo" é
 *    zero horas de domingo. O caso "não há registo desta semana" tem porta
 *    própria — o DELETE — e é essa a distinção que o quadro mostra como `—`
 *    contra `0,00`.
 *
 * 2. **Um valor impossível não se grava nem se corrige.** 900 horas numa semana
 *    ou um texto no campo devolvem `undefined`, que quer dizer "não escrevas
 *    esta coluna": o que lá estava fica. Corrigir para 168 ou para 0 seria
 *    inventar um número que ninguém escreveu.
 */

/** Horas por semana que uma pessoa pode ter: mais do que isto não existe. */
export const MAX_HORAS = 168;

/**
 * Lê um campo de horas.
 *
 * `0` para vazio · o número quando é válido · `undefined` quando é impossível
 * (e aí a coluna não se toca).
 */
export function valorDeHoras(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  if (n < 0 || n > MAX_HORAS) return undefined;
  return n;
}

/**
 * O bruto forçado à mão. Este SIM aceita nulo — a coluna é anulável, e nulo
 * quer dizer "não há valor forçado, usa as taxas". Zero seria outra coisa:
 * "esta semana paga zero", que é uma afirmação diferente.
 */
export function valorForcado(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/**
 * Monta as colunas a escrever, a partir do corpo do pedido.
 *
 * Só entram os campos que VIERAM no pedido: assim uma tela que edita as horas
 * não apaga sem querer o domingo que outra pessoa lançou na mesma célula.
 */
export function colunasDaCelula(b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const numericos: [string, string][] = [
    ["hours", "hours"], ["sundayHours", "sunday_hours"], ["holidayHours", "holiday_hours"],
  ];
  for (const [doPedido, naBase] of numericos) {
    if (!(doPedido in b)) continue;
    const v = valorDeHoras(b[doPedido]);
    if (v !== undefined) out[naBase] = v;
  }
  // `week_worked` também é not null: sem marca é `false`, e não nulo.
  if ("weekWorked" in b) out.week_worked = Boolean(b.weekWorked);
  if ("grossOverride" in b) {
    const g = valorForcado(b.grossOverride);
    if (g !== undefined) out.gross_override = g;
  }
  return out;
}
