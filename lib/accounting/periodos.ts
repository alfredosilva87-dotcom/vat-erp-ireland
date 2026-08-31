import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { primeiroMesAberto, type PeriodoFechado } from "./fechamentoPuro";

/**
 * Quem está fechado, e até quando.
 *
 * Separado de `fechamento.ts` de propósito: a pergunta "este mês está fechado?"
 * é feita por partes do sistema que nada têm a ver com a rotina de fecho — o
 * título de imposto, por exemplo. Se ela vivesse lá, importá-la arrastaria a
 * conciliação fiscal inteira, e a conciliação fiscal importa o título de
 * imposto: um ciclo, para responder a uma pergunta de uma linha.
 */

export type PeriodoGravado = {
  id: string;
  periodStart: string;
  periodEnd: string;
  closedAt: string;
  note: string | null;
  checks: any[] | null;
};

/** Os fechos ATIVOS deste cliente — os reabertos não travam nada. */
export async function periodosFechados(clientId: string): Promise<PeriodoGravado[]> {
  const { data } = await getServerSupabase().from("accounting_periods")
    .select("id,period_start,period_end,closed_at,note,checks")
    .eq("client_id", clientId).is("reopened_at", null)
    .order("period_end", { ascending: false });
  return ((data ?? []) as any[]).map((p) => ({
    id: p.id, periodStart: p.period_start, periodEnd: p.period_end,
    closedAt: p.closed_at, note: p.note ?? null, checks: p.checks ?? null,
  }));
}

export const paraPuro = (ps: PeriodoGravado[]): PeriodoFechado[] =>
  ps.map((p) => ({ periodStart: p.periodStart, periodEnd: p.periodEnd }));

/**
 * O período inteiro está fechado?
 *
 * Devolve o primeiro mês que falta, e não um simples não: quem pergunta isto
 * está a tentar fazer alguma coisa, e "falta fechar março" diz-lhe o que fazer
 * a seguir. "O período não está fechado" manda-o procurar.
 */
export async function periodoTravado(
  clientId: string, de: string, ate: string
): Promise<{ fechado: boolean; primeiroAberto: string | null }> {
  const aberto = primeiroMesAberto(de, ate, paraPuro(await periodosFechados(clientId)));
  return { fechado: aberto === null, primeiroAberto: aberto };
}
