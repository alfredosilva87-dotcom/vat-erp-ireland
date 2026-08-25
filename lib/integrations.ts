import "server-only";
import { getServerSupabase } from "@/lib/supabase";

/**
 * Que módulos se integram entre si, por cliente.
 *
 * Um escritório não trata todos os clientes da mesma maneira. O que tem duas
 * notas por mês pode não querer contas a pagar nenhuma — quer lançar a nota e
 * pagar quando pagar. Ligar tudo para toda a gente enche a tela dele de
 * títulos que ninguém vai baixar, e uma lista de pendências que ninguém trata
 * deixa de ser lida, inclusive nos clientes onde ela importa.
 *
 * **Ausência de linha significa TUDO LIGADO.** Assim um cliente criado antes
 * desta tabela — ou criado depois, sem ninguém abrir as configurações —
 * continua a comportar-se como sempre. O contrário faria a integração
 * desaparecer em silêncio no dia em que a migração subisse.
 */

export type Integracoes = {
  purchases_to_payable: boolean;
  sales_to_receivable: boolean;
  documents_to_accounting: boolean;
  hr_to_payable: boolean;
  bank_settles_titles: boolean;
};

export const TUDO_LIGADO: Integracoes = {
  purchases_to_payable: true,
  sales_to_receivable: true,
  documents_to_accounting: true,
  hr_to_payable: true,
  bank_settles_titles: true,
};

export const CHAVES = Object.keys(TUDO_LIGADO) as (keyof Integracoes)[];

export async function integracoesDo(clientId: string): Promise<Integracoes> {
  const { data } = await getServerSupabase()
    .from("client_integrations").select(CHAVES.join(",")).eq("client_id", clientId).maybeSingle();
  if (!data) return { ...TUDO_LIGADO };
  // Campo em falta cai no ligado, e não em `false`: uma coluna nova
  // acrescentada numa migração futura não pode desligar integração de ninguém
  // enquanto as linhas antigas não forem atualizadas.
  const linha = data as any;
  const out = { ...TUDO_LIGADO };
  for (const k of CHAVES) if (typeof linha[k] === "boolean") out[k] = linha[k];
  return out;
}

export async function gravarIntegracoes(
  clientId: string, patch: Partial<Integracoes>, userId?: string | null
): Promise<Integracoes> {
  const atual = await integracoesDo(clientId);
  const proximo = { ...atual, ...patch };
  const { error } = await getServerSupabase().from("client_integrations").upsert({
    client_id: clientId, ...proximo, updated_by: userId ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: "client_id" });
  if (error) throw new Error(error.message);
  return proximo;
}
