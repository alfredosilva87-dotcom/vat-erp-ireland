import "server-only";
import { getServerSupabase } from "@/lib/supabase";

/**
 * Os tipos de encargo e a conta de cada um em CADA LADO do título.
 *
 * A conta é resolvida AQUI, no servidor, a partir do tipo e da natureza do
 * título — e não enviada pela tela. Foi assim que o erro apareceu: a tela
 * mandava "juros → 7100" fixo, e num título a receber isso creditava uma
 * conta de despesa. Quem escolhe a conta tem de saber de que lado está, e a
 * tela não é o lugar certo para essa decisão.
 */

export type TipoDeEncargo = {
  key: string; label: string;
  account_payable: string; account_receivable: string;
  effect: "increase" | "decrease";
  sort: number; active: boolean;
};

export async function tiposDeEncargo(): Promise<TipoDeEncargo[]> {
  const { data } = await getServerSupabase()
    .from("charge_types").select("*").eq("active", true).order("sort");
  return (data ?? []) as TipoDeEncargo[];
}

/** A conta de resultado deste encargo, neste lado. */
export async function contaDoEncargo(
  chaveDoTipo: string, naturezaDoTitulo: "payable" | "receivable"
): Promise<{ conta: string | null; tipo: TipoDeEncargo | null }> {
  const { data } = await getServerSupabase()
    .from("charge_types").select("*").eq("key", chaveDoTipo).maybeSingle();
  const tipo = (data as TipoDeEncargo) ?? null;
  if (!tipo) return { conta: null, tipo: null };
  return {
    conta: naturezaDoTitulo === "payable" ? tipo.account_payable : tipo.account_receivable,
    tipo,
  };
}
