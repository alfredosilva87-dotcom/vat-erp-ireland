/**
 * Trilha de auditoria, documentos extras e aprovação (camada B3).
 *
 * A regra que dá forma ao arquivo: **a trilha é escrita pelo mesmo caminho que
 * faz a alteração**, nunca por uma chamada separada que a tela precisa lembrar
 * de fazer. Uma trilha que depende de a interface colaborar é uma trilha com
 * buracos, e um buraco numa trilha de auditoria vale menos que nenhuma trilha —
 * porque dá a impressão de cobertura.
 */

import { randomUUID } from "crypto";
import { getServerSupabase } from "@/lib/supabase";
import type { SessionUser } from "@/lib/auth";

const sb = () => getServerSupabase();
const BUCKET = "documents";

export type AuditAction =
  | "created"
  | "edited"
  | "item_edited"
  | "item_added"
  | "approved"
  | "reopened"
  | "documents_merged";

export interface AuditEntry {
  id: string;
  invoice_id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: AuditAction;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
  created_at: string;
}

export interface InvoiceDocument {
  id: string;
  invoice_id: string;
  document_path: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  source: string;
  note: string | null;
  added_by: string | null;
  added_by_email: string | null;
  added_at: string;
}

/** Quem está agindo. Nulo quando a ação vem de um caminho sem sessão. */
export type Actor = Pick<SessionUser, "id" | "email"> | null;

const asText = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v).trim();
  return s ? s.slice(0, 500) : null;
};

/**
 * Grava eventos na trilha.
 *
 * Nunca lança. Um erro ao gravar histórico não pode derrubar a alteração que o
 * contador acabou de fazer — perder o registro de uma edição é ruim, perder a
 * edição é pior, e as duas juntas seriam o pior de tudo.
 */
export async function recordAudit(
  invoiceId: string,
  actor: Actor,
  entries: Array<{ action: AuditAction; field?: string | null; old?: unknown; new?: unknown; note?: string | null }>
): Promise<void> {
  if (!entries.length) return;
  const rows = entries.map((e) => ({
    invoice_id: invoiceId,
    actor_id: actor?.id ?? null,
    // Copiado, não referenciado: se o usuário for apagado no ano seguinte, a
    // trilha tem de continuar dizendo quem foi.
    actor_email: actor?.email ?? null,
    action: e.action,
    field: e.field ?? null,
    old_value: asText(e.old),
    new_value: asText(e.new),
    note: e.note ?? null,
  }));
  // Não lança, mas RECLAMA no log do servidor. Engolir em silêncio faria uma
  // trilha quebrada parecer uma trilha vazia — e "esta nota nunca foi alterada"
  // é a conclusão errada mais cara que este arquivo pode produzir. Descoberto
  // testando: o insert falhava e a tela mostrava histórico vazio, indistinguível
  // de nota intocada.
  try {
    const { error } = await sb().from("invoice_audit").insert(rows);
    if (error) console.error("[invoice_audit] não foi possível gravar a trilha:", error.message);
  } catch (e: any) {
    console.error("[invoice_audit] não foi possível gravar a trilha:", e?.message || e);
  }
}

export async function listAudit(invoiceId: string): Promise<AuditEntry[]> {
  const { data } = await sb()
    .from("invoice_audit").select("*").eq("invoice_id", invoiceId)
    .order("created_at", { ascending: false });
  return (data ?? []) as AuditEntry[];
}

/**
 * Compara o que veio com o que está gravado e devolve só o que MUDOU.
 *
 * Sem isto, salvar a tela de edição sem tocar em nada registraria vinte campos
 * "alterados" de X para X, e a trilha ficaria ilegível justamente nas notas mais
 * mexidas — que são as que alguém vai querer conferir.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[]
): Array<{ field: string; old: unknown; new: unknown }> {
  const out: Array<{ field: string; old: unknown; new: unknown }> = [];
  for (const f of fields) {
    if (!(f in after)) continue;
    const a = before[f];
    const b = after[f];
    // Número vindo do navegador chega como string ("123.00" contra 123), e
    // comparar direto acusaria alteração em campo intocado.
    const same =
      a === b ||
      (a == null && b == null) ||
      (a != null && b != null && typeof a !== "object" && typeof b !== "object" &&
        String(a) === String(b)) ||
      (isNum(a) && isNum(b) && Math.abs(Number(a) - Number(b)) < 0.005);
    if (!same) out.push({ field: f, old: a, new: b });
  }
  return out;
}

const isNum = (v: unknown) => v !== null && v !== "" && v !== undefined && !Number.isNaN(Number(v));

// ---------------- documentos extras ----------------

export async function listInvoiceDocuments(invoiceId: string): Promise<InvoiceDocument[]> {
  const { data } = await sb()
    .from("invoice_documents").select("*").eq("invoice_id", invoiceId).order("added_at");
  return (data ?? []) as InvoiceDocument[];
}

export interface MergeInput {
  invoiceId: string;
  bytes: Buffer;
  filename: string;
  mimeType: string;
  note?: string | null;
}

export type MergeResult =
  | { kind: "merged"; document: InvoiceDocument }
  | { kind: "error"; error: string };

/**
 * Junta o documento de uma duplicata ao lançamento que já existe.
 *
 * É o oposto do que o sistema fazia antes: a segunda cópia era descartada, e com
 * ela a foto que muitas vezes está mais legível que a primeira (o recibo
 * fotografado de novo, sem o dedo na frente do total). Nada do lançamento é
 * alterado — nem valor, nem crédito, nem alíquota. Só entra um documento a mais,
 * porque juntar não é recalcular: se os números dos dois documentos divergem, o
 * que existe é uma decisão para o contador tomar na tela, não uma média para o
 * sistema fazer sozinho.
 */
export async function mergeDocument(input: MergeInput, actor: Actor): Promise<MergeResult> {
  const { data: inv } = await sb()
    .from("invoices").select("id").eq("id", input.invoiceId).maybeSingle();
  if (!inv) return { kind: "error", error: "Nota não encontrada." };

  const ext = (/\.([a-z0-9]{2,5})$/i.exec(input.filename)?.[1]
    || (input.mimeType === "application/pdf" ? "pdf" : input.mimeType.split("/")[1])
    || "bin").toLowerCase();
  const path = `merged/${randomUUID()}.${ext}`;

  const { error: upErr } = await sb().storage
    .from(BUCKET).upload(path, input.bytes, { contentType: input.mimeType, upsert: true });
  if (upErr) return { kind: "error", error: `Não foi possível guardar o documento: ${upErr.message}` };

  const { data, error } = await sb().from("invoice_documents").insert({
    invoice_id: input.invoiceId,
    document_path: path,
    filename: input.filename.slice(-120),
    mime_type: input.mimeType,
    size_bytes: input.bytes.length,
    source: "merged",
    note: input.note ?? null,
    added_by: actor?.id ?? null,
    // Copiado, como na trilha: quem juntou o documento tem de continuar
    // identificável depois de sair do escritório.
    added_by_email: actor?.email ?? null,
  }).select().single();

  if (error) {
    try { await sb().storage.from(BUCKET).remove([path]); } catch { /* nada a fazer */ }
    return { kind: "error", error: error.message };
  }

  await recordAudit(input.invoiceId, actor, [{
    action: "documents_merged",
    field: "document",
    new: input.filename,
    note: "Documento de uma duplicata juntado a este lançamento.",
  }]);

  return { kind: "merged", document: data as InvoiceDocument };
}

export async function downloadInvoiceDocument(
  docId: string
): Promise<{ bytes: Buffer; mime: string; filename: string } | null> {
  const { data: row } = await sb()
    .from("invoice_documents").select("*").eq("id", docId).maybeSingle();
  const doc = row as InvoiceDocument | null;
  if (!doc) return null;
  const { data, error } = await sb().storage.from(BUCKET).download(doc.document_path);
  if (error || !data) return null;
  return {
    bytes: Buffer.from(await data.arrayBuffer()),
    mime: doc.mime_type || "application/octet-stream",
    filename: doc.filename || "documento",
  };
}

// ---------------- aprovação ----------------

export interface ApprovalOutcome {
  approved: string[];
  /** Notas que já estavam aprovadas — contadas à parte, não como sucesso novo. */
  alreadyApproved: string[];
  notFound: string[];
}

/**
 * Aprova várias notas de uma vez.
 *
 * O limite é o mesmo raciocínio do lote da camada A7: acima de um certo número
 * ninguém confere de verdade, e aprovar em massa o que não foi olhado é assinar
 * embaixo de um número que não se leu. Aqui o limite é mais generoso porque
 * aprovar não cria lançamento nenhum — é reversível e não mexe em dinheiro.
 */
export const APPROVE_LIMIT = 200;

export async function approveInvoices(
  ids: string[], actor: Actor
): Promise<ApprovalOutcome | { error: string }> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return { error: "Nenhuma nota selecionada." };
  if (unique.length > APPROVE_LIMIT) {
    return { error: `São ${unique.length} notas de uma vez. O limite é ${APPROVE_LIMIT} — acima disso ninguém confere de verdade.` };
  }

  const { data: found } = await sb()
    .from("invoices").select("id,needs_review,reviewed_at").in("id", unique);
  const rows = (found ?? []) as { id: string; needs_review: boolean; reviewed_at: string | null }[];
  const foundIds = new Set(rows.map((r) => r.id));

  const already = rows.filter((r) => r.reviewed_at != null).map((r) => r.id);
  const toApprove = rows.filter((r) => r.reviewed_at == null).map((r) => r.id);

  if (toApprove.length) {
    await sb().from("invoices").update({
      needs_review: false,
      reviewed_at: new Date().toISOString(),
      reviewed_by: actor?.id ?? null,
      reviewed_by_email: actor?.email ?? null,
    }).in("id", toApprove);

    // Uma linha de trilha por nota, num insert só: a pergunta da auditoria é
    // sempre sobre UMA nota, então o registro tem de estar nela e não num lote
    // que alguém precisaria procurar.
    await sb().from("invoice_audit").insert(toApprove.map((id) => ({
      invoice_id: id,
      actor_id: actor?.id ?? null,
      actor_email: actor?.email ?? null,
      action: "approved" as AuditAction,
      note: toApprove.length > 1 ? `Aprovada em lote (${toApprove.length} notas).` : null,
    })));
  }

  return {
    approved: toApprove,
    alreadyApproved: already,
    notFound: unique.filter((id) => !foundIds.has(id)),
  };
}

/**
 * Desfaz a aprovação.
 *
 * Só de administrador, pela mesma razão de reabrir um período fechado na camada
 * A5: aprovar é rotina, desfazer é exceção, e apagar o registro de uma
 * conferência por engano no meio de outro trabalho é o tipo de coisa que ninguém
 * percebe até a auditoria.
 */
export async function reopenInvoice(id: string, actor: Actor, note?: string | null): Promise<boolean> {
  const { error } = await sb().from("invoices").update({
    needs_review: true, reviewed_at: null, reviewed_by: null, reviewed_by_email: null,
  }).eq("id", id);
  if (error) return false;
  await recordAudit(id, actor, [{ action: "reopened", note: note ?? "Aprovação desfeita." }]);
  return true;
}
