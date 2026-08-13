import { getRelaySupabase, relayConfigured, RELAY_BUCKET } from "./relay";
import { getServerSupabase } from "./supabase";
import { addInboxItem } from "./mailStore";
import { captureDescription } from "./phoneIntake";

/**
 * Busca as fotos que os clientes mandaram e apaga da nuvem. RODA NO ESCRITÓRIO.
 *
 * É o outro lado da camada B4. A nuvem é balcão, não arquivo: o que faz dela
 * trânsito em vez de armazenamento é este passo apagar. Se ele parar de rodar, a
 * passagem acumula documento de cliente — então o registro de cada busca fica em
 * `phone_fetches`, para o escritório notar o silêncio.
 *
 * Só fala PARA FORA. Nenhuma porta é aberta na rede do escritório, que é a
 * premissa que o self-host inteiro protege.
 */

/**
 * Quantos envios por busca.
 *
 * Existe pelo mesmo motivo do limite da busca de e-mail: sem teto, a primeira
 * busca depois de um fim de semana movimentado tenta baixar tudo e estoura o
 * tempo da rota, e nada entra. Com teto, ela entra em duas voltas.
 */
export const FETCH_LIMIT = 40;

export interface PhoneFetchOutcome {
  configured: boolean;
  found: number;
  ingested: number;
  duplicates: number;
  failed: number;
  error: string | null;
}

const empty = (over: Partial<PhoneFetchOutcome> = {}): PhoneFetchOutcome => ({
  configured: true, found: 0, ingested: 0, duplicates: 0, failed: 0, error: null, ...over,
});

/**
 * Empurra a cópia de um link para a nuvem.
 *
 * Separado da busca porque o momento é outro: quando o escritório cria ou revoga
 * um link, isso precisa valer **agora** — não no próximo ciclo de 30 minutos.
 * Link criado que ainda não funciona é o escritório mandando por WhatsApp um
 * endereço que não abre.
 */
export async function pushPhoneLink(link: {
  token: string; client_id: string; label: string | null; person: string;
  allow_sale: boolean; active: boolean; expires_at: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!relayConfigured()) return { ok: false, error: "Passagem na nuvem não configurada." };
  const relay = getRelaySupabase();
  const { error } = await relay.from("phone_links").upsert({
    token: link.token, client_id: link.client_id, label: link.label,
    person: link.person, allow_sale: link.allow_sale, active: link.active,
    expires_at: link.expires_at, updated_at: new Date().toISOString(),
  }, { onConflict: "token" });
  if (error) return { ok: false, error: error.message };

  // Marca no banco do escritório que a nuvem já sabe. É o que a tela lê para
  // dizer se o link está valendo, em vez de afirmar que está sem ter conferido.
  await getServerSupabase().from("client_phone_links")
    .update({ synced_at: new Date().toISOString() }).eq("token", link.token);
  return { ok: true };
}

/**
 * Uma volta da busca.
 *
 * A ordem importa: baixa, grava na fila, e só então apaga da nuvem. Apagar antes
 * de a linha existir perderia a foto do cliente — que ele já viu como "Enviado" e
 * não vai mandar de novo. Na dúvida a foto fica na nuvem e a próxima volta pega:
 * duplicata é recusada pelo índice, perda não tem conserto.
 */
export async function fetchPhoneOnce(): Promise<PhoneFetchOutcome> {
  if (!relayConfigured()) {
    return empty({ configured: false, error: "Passagem na nuvem não configurada." });
  }

  const office = getServerSupabase();
  const relay = getRelaySupabase();

  const { data: log } = await office
    .from("phone_fetches").insert({}).select("id").single();
  const fetchId: string | null = (log as any)?.id ?? null;

  const out = empty();

  const { data: rows, error: listErr } = await relay
    .from("phone_uploads")
    .select("*")
    .is("fetched_at", null)
    .order("sent_at", { ascending: true })
    .limit(FETCH_LIMIT);

  if (listErr) {
    out.error = listErr.message;
    if (fetchId) await finish(fetchId, out);
    return out;
  }

  out.found = (rows || []).length;

  for (const row of rows || []) {
    try {
      const dl = await relay.storage.from(RELAY_BUCKET).download(row.storage_path);
      if (dl.error || !dl.data) {
        // O arquivo não está lá, mas a linha está. Não é para tentar para sempre:
        // marca como buscada com o motivo, senão toda volta futura tropeça nela.
        out.failed++;
        await relay.from("phone_uploads")
          .update({ fetched_at: new Date().toISOString() }).eq("id", row.id);
        continue;
      }
      const bytes = Buffer.from(await dl.data.arrayBuffer());

      const added = await addInboxItem({
        client_id: row.client_id,
        direction: row.direction,
        fetch_id: null,
        source: "phone",
        // O remetente é a PESSOA, não um endereço: é o que o analista precisa
        // para saber de quem veio a foto.
        sender: row.person || null,
        subject: null,
        body: captureDescription(row.person || "", row.note),
        received_at: row.sent_at,
        // Guarda de qual envio veio. Se a volta cair entre gravar e apagar, a
        // próxima reconhece pelo hash e não cria um segundo item.
        message_id: `relay:${row.upload_id}`,
        filename: row.filename,
        mime_type: row.mime_type,
        bytes,
      });

      if (added.kind === "error") {
        out.failed++;
        continue; // fica na nuvem: a próxima volta tenta de novo
      }
      if (added.kind === "duplicate") out.duplicates++;
      else out.ingested++;

      // Entrou (ou já existia): sai da nuvem. Esta é a linha que faz da passagem
      // um trânsito, e é o que o compliance do escritório está aprovando.
      await relay.storage.from(RELAY_BUCKET).remove([row.storage_path]);
      await relay.from("phone_uploads").delete().eq("id", row.id);
    } catch (e: any) {
      out.failed++;
      // Não interrompe o resto: uma foto corrompida não deve travar as outras 39.
    }
  }

  if (fetchId) await finish(fetchId, out);
  return out;
}

async function finish(id: string, out: PhoneFetchOutcome) {
  await getServerSupabase().from("phone_fetches").update({
    finished_at: new Date().toISOString(),
    found: out.found, ingested: out.ingested,
    duplicates: out.duplicates, failed: out.failed, error: out.error,
  }).eq("id", id);
}

export async function listPhoneFetches(limit = 20) {
  const { data } = await getServerSupabase()
    .from("phone_fetches").select("*").order("started_at", { ascending: false }).limit(limit);
  return data || [];
}
