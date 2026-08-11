/**
 * A fila da entrada por e-mail e os endereços (camada B2).
 *
 * O motor que decide o que entra é `lib/mailIngest.ts`, e é puro. A busca IMAP é
 * `lib/mailFetch.ts`. Aqui só entra o que precisa de banco e de storage.
 */

import { createHash, randomBytes, randomUUID } from "crypto";
import { getServerSupabase } from "@/lib/supabase";
import type { MailDirection, MailRoute, SenderRule } from "@/lib/mailIngest";

const sb = () => getServerSupabase();
const BUCKET = "documents";

export interface ClientMailRoute extends MailRoute {
  id: string;
  created_at: string;
}

export interface MailSender extends SenderRule {
  id: string;
  note: string | null;
  created_at: string;
}

export type InboxStatus = "pending" | "read" | "saved" | "duplicate" | "refused" | "discarded";

export interface InboxItem {
  id: string;
  client_id: string | null;
  direction: MailDirection | null;
  fetch_id: string | null;
  source: string;
  sender: string | null;
  subject: string | null;
  body: string | null;
  received_at: string | null;
  message_id: string | null;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  document_path: string | null;
  content_hash: string | null;
  status: InboxStatus;
  refused_reason: string | null;
  invoice_id: string | null;
  invoice_count: number;
  created_at: string;
  updated_at: string;
}

export interface MailFetchLog {
  id: string;
  mailbox: string | null;
  seen_count: number;
  accepted_count: number;
  refused_count: number;
  duplicate_count: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/**
 * O token que vai no endereço, depois do `+`.
 *
 * Sem vogais e sem os caracteres que se confundem lidos em voz alta ou copiados
 * de um pedido impresso (`0`/`o`, `1`/`l`): o endereço vai ser ditado ao
 * fornecedor por telefone mais vezes do que a gente gostaria. Sem vogal também
 * porque token aleatório com vogal produz palavra, e palavra produz reclamação.
 */
const TOKEN_ALPHABET = "bcdfghjkmnpqrstvwxz23456789";
export function newRouteToken(size = 8): string {
  const bytes = randomBytes(size);
  let out = "";
  for (let i = 0; i < size; i++) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return out;
}

// ---------------- endereços ----------------

export async function listMailRoutes(clientId?: string): Promise<ClientMailRoute[]> {
  let q = sb().from("client_mail_routes").select("*").order("direction");
  if (clientId) q = q.eq("client_id", clientId);
  const { data } = await q;
  return (data ?? []) as ClientMailRoute[];
}

/**
 * Cria (ou devolve) o endereço de um cliente para uma direção.
 *
 * A colisão de token é tratada com nova tentativa em vez de confiança na
 * aleatoriedade: são 27^8 possibilidades, a colisão é remota, mas se acontecer
 * uma vez a nota de um cliente entra na conta de outro — e esse é o pior defeito
 * possível num escritório que atende empresas concorrentes.
 */
export async function ensureMailRoute(
  clientId: string, direction: MailDirection
): Promise<ClientMailRoute | null> {
  const { data: existing } = await sb()
    .from("client_mail_routes").select("*")
    .eq("client_id", clientId).eq("direction", direction).maybeSingle();
  if (existing) return existing as ClientMailRoute;

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await sb()
      .from("client_mail_routes")
      .insert({ client_id: clientId, direction, token: newRouteToken() })
      .select().single();
    if (!error) return data as ClientMailRoute;
    // 23505 = token repetido. Qualquer outro erro não melhora tentando de novo.
    if ((error as any).code !== "23505") throw error;
  }
  return null;
}

export async function setMailRouteActive(id: string, active: boolean): Promise<boolean> {
  const { error } = await sb().from("client_mail_routes").update({ active }).eq("id", id);
  return !error;
}

/**
 * Troca o token, mantendo o cliente e a direção.
 *
 * Existe porque o endereço é dado a terceiros: quando ele vaza para uma lista de
 * spam, o conserto é trocar o endereço, não desligar a entrada por e-mail do
 * cliente inteiro.
 */
export async function rotateMailRoute(id: string): Promise<ClientMailRoute | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await sb()
      .from("client_mail_routes").update({ token: newRouteToken() }).eq("id", id).select().maybeSingle();
    if (!error) return (data as ClientMailRoute) ?? null;
    if ((error as any).code !== "23505") throw error;
  }
  return null;
}

// ---------------- remetentes ----------------

export async function listMailSenders(clientId?: string): Promise<MailSender[]> {
  let q = sb().from("mail_senders").select("*").order("created_at");
  // O `is null` entra junto porque a regra global vale para este cliente também,
  // e uma tela que só mostra as específicas esconderia por que o remetente foi
  // recusado.
  if (clientId) q = q.or(`client_id.eq.${clientId},client_id.is.null`);
  const { data } = await q;
  return (data ?? []) as MailSender[];
}

export async function createMailSender(input: {
  client_id: string | null; pattern: string; mode: "allow" | "block"; note?: string | null;
}): Promise<{ sender?: MailSender; error?: string }> {
  const pattern = String(input.pattern ?? "").trim().toLowerCase().slice(0, 200);
  if (!pattern) return { error: "Escreva o endereço ou o domínio." };
  // Um domínio começa com @; um endereço tem @ no meio. Sem isso, "fornecedor.ie"
  // digitado sem o @ não casaria com nada e pareceria uma regra funcionando.
  if (!pattern.includes("@")) {
    return { error: "Use o endereço inteiro (ap@fornecedor.ie) ou o domínio com arroba (@fornecedor.ie)." };
  }
  if (input.mode !== "allow" && input.mode !== "block") return { error: "Modo inválido." };

  const { data, error } = await sb().from("mail_senders").insert({
    client_id: input.client_id || null,
    pattern,
    mode: input.mode,
    note: input.note ? String(input.note).trim().slice(0, 200) : null,
  }).select().single();
  if (error) return { error: error.message };
  return { sender: data as MailSender };
}

export async function deleteMailSender(id: string): Promise<boolean> {
  const { error } = await sb().from("mail_senders").delete().eq("id", id);
  return !error;
}

// ---------------- a fila ----------------

export interface InboxFilter {
  clientId?: string;
  status?: InboxStatus[];
}

export async function listInboxItems(f: InboxFilter = {}): Promise<InboxItem[]> {
  let q = sb().from("inbox_items").select("*").order("created_at", { ascending: false });
  if (f.clientId) q = q.eq("client_id", f.clientId);
  if (f.status?.length) q = q.in("status", f.status);
  const { data } = await q;
  return (data ?? []) as InboxItem[];
}

export async function getInboxItem(id: string): Promise<InboxItem | null> {
  const { data } = await sb().from("inbox_items").select("*").eq("id", id).maybeSingle();
  return (data as InboxItem) ?? null;
}

export interface NewInboxItem {
  client_id: string | null;
  direction: MailDirection | null;
  fetch_id: string | null;
  sender: string | null;
  subject: string | null;
  body: string | null;
  received_at: string | null;
  message_id: string | null;
  filename: string;
  mime_type: string;
  bytes: Buffer;
  status?: InboxStatus;
  refused_reason?: string | null;
}

const extOf = (mime: string, filename: string): string => {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(filename || "");
  if (fromName) return fromName[1].toLowerCase();
  if (mime === "application/pdf") return "pdf";
  return (mime.split("/")[1] || "bin").toLowerCase();
};

export type AddResult =
  | { kind: "added"; item: InboxItem }
  | { kind: "duplicate"; existing: InboxItem }
  | { kind: "error"; error: string };

/**
 * Põe um anexo na fila.
 *
 * O arquivo sobe para o storage ANTES da linha, e a linha é que decide se ele
 * fica: gravar a linha primeiro deixaria um item na fila apontando para um
 * arquivo que não subiu, e a tela mostraria "chegou" para algo que não dá para
 * abrir.
 *
 * A duplicata é reconhecida pelo hash do conteúdo, e recusada **pelo banco**
 * (índice único). Filtrar antes de gravar pareceria funcionar e falharia no dia
 * em que duas buscas rodam juntas — o cron encavalando com o botão. É a mesma
 * lição da importação de extrato, camada A1.
 */
export async function addInboxItem(input: NewInboxItem): Promise<AddResult> {
  const hash = sha256(input.bytes);

  // A direção faz parte da chave: quem manda a nota para o endereço errado e
  // reenvia para o certo teria a segunda — a certa — engolida como duplicata.
  if (input.client_id && input.direction) {
    const { data: prior } = await sb()
      .from("inbox_items").select("*")
      .eq("client_id", input.client_id).eq("direction", input.direction)
      .eq("content_hash", hash).maybeSingle();
    if (prior) return { kind: "duplicate", existing: prior as InboxItem };
  }

  const id = randomUUID();
  const ext = extOf(input.mime_type, input.filename);
  const path = `inbox/${id}.${ext}`;
  const { error: upErr } = await sb().storage
    .from(BUCKET).upload(path, input.bytes, { contentType: input.mime_type, upsert: true });
  if (upErr) return { kind: "error", error: `Não foi possível guardar o anexo: ${upErr.message}` };

  const row = {
    id,
    client_id: input.client_id,
    direction: input.direction,
    fetch_id: input.fetch_id,
    source: "email",
    sender: input.sender,
    subject: input.subject,
    body: input.body,
    received_at: input.received_at,
    message_id: input.message_id,
    filename: input.filename,
    mime_type: input.mime_type,
    size_bytes: input.bytes.length,
    document_path: path,
    content_hash: hash,
    status: input.status ?? "pending",
    refused_reason: input.refused_reason ?? null,
  };

  const { data, error } = await sb().from("inbox_items").insert(row).select().single();
  if (error) {
    if ((error as any).code === "23505") {
      // Outra busca ganhou a corrida. O arquivo que acabou de subir não tem
      // linha, então sai — senão o bucket acumula anexo órfão a cada corrida.
      try { await sb().storage.from(BUCKET).remove([path]); } catch { /* o item existe, o que importa */ }
      const { data: prior } = await sb()
        .from("inbox_items").select("*")
        .eq("client_id", input.client_id as string).eq("direction", input.direction as string)
        .eq("content_hash", hash).maybeSingle();
      if (prior) return { kind: "duplicate", existing: prior as InboxItem };
    }
    return { kind: "error", error: error.message };
  }
  return { kind: "added", item: data as InboxItem };
}

export async function updateInboxItem(
  id: string, patch: Partial<Pick<InboxItem, "status" | "client_id" | "direction" | "invoice_id" | "invoice_count" | "refused_reason">>
): Promise<InboxItem | null> {
  const row: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  const { data } = await sb().from("inbox_items").update(row).eq("id", id).select().maybeSingle();
  return (data as InboxItem) ?? null;
}

/** O anexo em bytes, para a leitura passar pelo mesmo caminho de sempre. */
export async function downloadInboxFile(
  id: string
): Promise<{ bytes: Buffer; mime: string; filename: string } | null> {
  const item = await getInboxItem(id);
  if (!item?.document_path) return null;
  const { data, error } = await sb().storage.from(BUCKET).download(item.document_path);
  if (error || !data) return null;
  return {
    bytes: Buffer.from(await data.arrayBuffer()),
    mime: item.mime_type || "application/octet-stream",
    filename: item.filename || "anexo",
  };
}

/**
 * Apaga o item e o anexo.
 *
 * Só para item que ainda não virou nota: depois de gravada, a nota é que manda no
 * documento, e apagar o arquivo aqui deixaria a nota sem o comprovante que a
 * sustenta numa auditoria.
 */
export async function deleteInboxItem(id: string): Promise<{ ok: boolean; error?: string }> {
  const item = await getInboxItem(id);
  if (!item) return { ok: false, error: "Item não encontrado." };
  if (item.status === "saved") {
    return { ok: false, error: "Este item já virou nota. Apague a nota, não o item da fila." };
  }
  if (item.document_path) {
    try { await sb().storage.from(BUCKET).remove([item.document_path]); } catch { /* a linha vai de todo jeito */ }
  }
  const { error } = await sb().from("inbox_items").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ---------------- registro das buscas ----------------

export async function startMailFetch(mailbox: string): Promise<string> {
  const { data } = await sb().from("mail_fetches").insert({ mailbox }).select("id").single();
  return data!.id as string;
}

export async function finishMailFetch(
  id: string,
  counts: { seen: number; accepted: number; refused: number; duplicate: number },
  error?: string | null
): Promise<void> {
  await sb().from("mail_fetches").update({
    seen_count: counts.seen,
    accepted_count: counts.accepted,
    refused_count: counts.refused,
    duplicate_count: counts.duplicate,
    error: error ?? null,
    finished_at: new Date().toISOString(),
  }).eq("id", id);
}

export async function listMailFetches(limit = 20): Promise<MailFetchLog[]> {
  const { data } = await sb()
    .from("mail_fetches").select("*").order("started_at", { ascending: false }).limit(limit);
  return (data ?? []) as MailFetchLog[];
}
