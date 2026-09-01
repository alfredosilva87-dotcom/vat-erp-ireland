import "server-only";

/**
 * Ler uma consulta INTEIRA do PostgREST, e não a primeira página dela.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO PRECISA DE EXISTIR
 *
 * `PGRST_DB_MAX_ROWS` está a 1000 por omissão, e o PostgREST corta aí **sem
 * erro e sem aviso**. Um `.limit(20000)` do lado do cliente não levanta o
 * tecto do servidor — pede-se 20000 e recebem-se 1000, com ar de resposta
 * completa.
 *
 * Apanhado em 2026-09-01 a testar a rotina nova: um cliente com 1634 linhas no
 * razão, duas partidas órfãs verdadeiras a seguir à milésima, e a verificação a
 * responder "está tudo bem". Numa rotina de verificação isso é o pior resultado
 * possível — ela existe precisamente para ser acreditada quando diz que não há
 * nada.
 *
 * Já tinha custado duas investigações antes (o balanço saía errado em silêncio
 * porque a leitura dos saldos não paginava, v1.35). A terceira vez vira função.
 * ---------------------------------------------------------------------------
 *
 * `montar` recebe o intervalo e devolve a consulta já com o `.range()` posto —
 * a ordenação fica com quem chama, porque paginar sem ordem estável devolve
 * linhas repetidas e linhas em falta.
 */
export async function lerTudo<T>(
  montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pagina = 1000
): Promise<T[]> {
  const todas: T[] = [];
  for (let inicio = 0; ; inicio += pagina) {
    const { data, error } = await montar(inicio, inicio + pagina - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as T[];
    todas.push(...lote);
    if (lote.length < pagina) break;
  }
  return todas;
}
