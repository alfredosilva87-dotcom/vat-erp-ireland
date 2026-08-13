import { getServerSupabase } from "./supabase";
import { newRouteToken } from "./mailStore";
import { pushPhoneLink } from "./phoneFetch";
import { relayConfigured } from "./relay";
import { PHONE_TOKEN_LEN } from "./phoneIntake";

/**
 * Os links de envio por telefone (camada B4), do lado do ESCRITÓRIO.
 *
 * Esta tabela é a dona do link. A passagem na nuvem tem uma cópia, para poder
 * recusar um envio sem alcançar o escritório — e a cópia é empurrada daqui.
 *
 * O empurrão acontece **na hora** de criar e de revogar, não no ciclo de 30
 * minutos: link recém-criado que ainda não funciona é o escritório mandando por
 * WhatsApp um endereço que não abre, e link revogado que continua aceitando foto
 * é pior ainda. Quando o empurrão falha, `synced_at` fica nulo e a tela diz isso
 * em vez de deixar o contador achar que está valendo.
 */

export interface PhoneLinkRow {
  id: string;
  client_id: string;
  token: string;
  person: string;
  allow_sale: boolean;
  active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  synced_at: string | null;
  created_at: string;
}

const sb = () => getServerSupabase();

export async function listPhoneLinks(clientId: string): Promise<PhoneLinkRow[]> {
  const { data } = await sb()
    .from("client_phone_links").select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  return (data || []) as PhoneLinkRow[];
}

/** O rótulo que o cliente vê na tela do telefone: o nome do próprio negócio. */
async function labelFor(clientId: string): Promise<string | null> {
  const { data } = await sb().from("clients").select("name").eq("id", clientId).maybeSingle();
  return ((data as any)?.name as string) ?? null;
}

export type CreateResult =
  | { ok: true; link: PhoneLinkRow; synced: boolean; syncError?: string }
  | { ok: false; error: string };

export async function createPhoneLink(input: {
  clientId: string;
  companyId: string | null;
  person: string;
  allowSale: boolean;
  expiresAt: string | null;
  createdBy: string | null;
}): Promise<CreateResult> {
  const person = input.person.trim();
  if (!person) return { ok: false, error: "Diga de quem é o link." };

  const row = {
    client_id: input.clientId,
    company_id: input.companyId,
    token: newRouteToken(PHONE_TOKEN_LEN),
    person,
    allow_sale: input.allowSale,
    expires_at: input.expiresAt,
    created_by: input.createdBy,
  };

  const { data, error } = await sb().from("client_phone_links").insert(row).select().single();
  if (error) {
    // O índice único é por (cliente, nome em minúsculas) entre os ativos: dois
    // "João" no mesmo cliente fariam a fila não dizer de quem veio a foto.
    if ((error as any).code === "23505") {
      return { ok: false, error: `Já existe um link ativo para “${person}” neste cliente.` };
    }
    return { ok: false, error: error.message };
  }

  const link = data as PhoneLinkRow;
  const sync = await syncOne(link);
  return { ok: true, link: { ...link, synced_at: sync.ok ? new Date().toISOString() : null },
           synced: sync.ok, syncError: sync.error };
}

/** Empurra um link para a passagem. Separado para poder ser repetido pela tela. */
export async function syncOne(link: PhoneLinkRow): Promise<{ ok: boolean; error?: string }> {
  if (!relayConfigured()) {
    return { ok: false, error: "A passagem na nuvem não está configurada neste servidor." };
  }
  return pushPhoneLink({
    token: link.token,
    client_id: link.client_id,
    label: await labelFor(link.client_id),
    person: link.person,
    allow_sale: link.allow_sale,
    active: link.active,
    expires_at: link.expires_at,
  });
}

/**
 * Liga e desliga.
 *
 * O banco só é atualizado DEPOIS de a nuvem confirmar, e só quando o destino é
 * desligar. Ao revogar, a ordem importa: marcar como inativo aqui e falhar o
 * empurrão deixaria a tela dizendo "revogado" com o link ainda aceitando foto —
 * a pior das duas mentiras possíveis.
 */
export async function setPhoneLinkActive(
  linkId: string, active: boolean
): Promise<{ ok: boolean; error?: string; link?: PhoneLinkRow }> {
  const { data: current } = await sb()
    .from("client_phone_links").select("*").eq("id", linkId).maybeSingle();
  if (!current) return { ok: false, error: "Link não encontrado." };

  const intended = { ...(current as PhoneLinkRow), active };
  const sync = await syncOne(intended);
  if (!active && !sync.ok) {
    return { ok: false, error: `Não deu para revogar na nuvem: ${sync.error}. O link continua valendo.` };
  }

  const { data, error } = await sb().from("client_phone_links")
    .update({ active, synced_at: sync.ok ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", linkId).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, link: data as PhoneLinkRow };
}

/**
 * Troca o token, mantendo a pessoa.
 *
 * É a revogação prática — telefone perdido, funcionário que saiu. O token antigo
 * é desligado na nuvem ANTES de o novo existir: se a ordem fosse a inversa e o
 * segundo passo falhasse, os dois valeriam ao mesmo tempo.
 */
export async function rotatePhoneLink(
  linkId: string
): Promise<{ ok: boolean; error?: string; link?: PhoneLinkRow }> {
  const { data: current } = await sb()
    .from("client_phone_links").select("*").eq("id", linkId).maybeSingle();
  if (!current) return { ok: false, error: "Link não encontrado." };
  const old = current as PhoneLinkRow;

  const off = await syncOne({ ...old, active: false });
  if (!off.ok) {
    return { ok: false, error: `Não deu para desligar o link antigo na nuvem: ${off.error}. Nada foi trocado.` };
  }

  const token = newRouteToken(PHONE_TOKEN_LEN);
  const { data, error } = await sb().from("client_phone_links")
    .update({ token, active: true, synced_at: null, updated_at: new Date().toISOString() })
    .eq("id", linkId).select().single();
  if (error) return { ok: false, error: error.message };

  const link = data as PhoneLinkRow;
  const on = await syncOne(link);
  if (on.ok) {
    await sb().from("client_phone_links")
      .update({ synced_at: new Date().toISOString() }).eq("id", linkId);
    return { ok: true, link: { ...link, synced_at: new Date().toISOString() } };
  }
  // O antigo já não vale e o novo ainda não chegou. A tela mostra "não
  // sincronizado" e o botão de tentar de novo — é recuperável, e o estado
  // inseguro (dois válidos) foi evitado.
  return { ok: true, link, error: on.error };
}

export async function deletePhoneLink(linkId: string): Promise<{ ok: boolean; error?: string }> {
  const off = await setPhoneLinkActive(linkId, false);
  if (!off.ok) return off;
  const { error } = await sb().from("client_phone_links").delete().eq("id", linkId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
