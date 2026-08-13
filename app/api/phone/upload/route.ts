import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { getRelaySupabase, RELAY_BUCKET } from "@/lib/relay";
import {
  isTokenShape, linkVerdict, directionFor, uploadVerdict, rateVerdict,
  captureFilename, RATE_LIMIT, NOTE_LIMIT, type PhoneLink,
} from "@/lib/phoneIntake";

export const dynamic = "force-dynamic";

/**
 * Recebe a foto do telefone. RODA NA NUVEM, e é PÚBLICA de propósito.
 *
 * Pública porque quem envia é o cliente do escritório, que não tem senha aqui —
 * o link dele é a credencial. Ver `lib/phoneIntake.ts` para o motivo: este
 * caminho só escreve, e não existe rota que leia com esse token.
 *
 * O que NÃO se confia no que o telefone manda:
 *   - a direção: quem decide é o link (`directionFor`), senão um pedido
 *     adulterado jogaria um custo na aba de vendas e mexeria no VAT a pagar;
 *   - o tamanho e o tipo: conferidos no arquivo que chegou, não no que ele diz;
 *   - o hash: recalculado aqui, senão a trava de duplicata do escritório
 *     obedeceria a um número escolhido por quem enviou;
 *   - o nome do arquivo: montado do que já é confiável.
 *
 * O `upload_id` vem do telefone e é o único campo dele que decide algo: é o que
 * torna a retentativa inofensiva quando o sinal cai no meio do envio.
 */

const MAX_BODY = 6 * 1024 * 1024; // margem sobre o teto de 4 MB do arquivo

function refuse(reason: string, status = 400) {
  // Mensagem curta e sem detalhe de banco: a resposta vai para um telefone na
  // rua, e a tela dele traduz o motivo para o idioma do cliente.
  return NextResponse.json({ ok: false, reason }, { status });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return refuse("bad_request");
  }

  const token = form.get("token");
  if (!isTokenShape(token)) return refuse("bad_token", 404);

  const uploadId = String(form.get("upload_id") || "").trim();
  if (!uploadId || uploadId.length > 64) return refuse("bad_upload_id");

  const file = form.get("file");
  if (!(file instanceof File)) return refuse("no_file");
  if (file.size > MAX_BODY) return refuse("too_big", 413);

  const relay = getRelaySupabase();

  // ---- o link serve? ----
  const { data: linkRow, error: linkErr } = await relay
    .from("phone_links")
    .select("token, client_id, label, person, allow_sale, active, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (linkErr) return refuse("server", 500);

  const today = new Date().toISOString().slice(0, 10);
  const verdict = linkVerdict(linkRow as PhoneLink | null, today);
  // "Não existe" e "revogado" respondem 404 igual: dizer qual dos dois confirma
  // para quem está tentando adivinhar que aquele token já foi válido.
  if (!verdict.ok) {
    return refuse(verdict.reason, verdict.reason === "expired" ? 403 : 404);
  }
  const link = verdict.link;

  // ---- a retentativa não duplica ----
  // Antes de qualquer trabalho: o caso comum de sinal ruim é o mesmo envio
  // chegando duas vezes, e ele deve custar uma consulta, não um upload.
  const { data: already } = await relay
    .from("phone_uploads").select("id").eq("upload_id", uploadId).maybeSingle();
  if (already) return NextResponse.json({ ok: true, already: true });

  // ---- teto de envios ----
  const since = new Date(Date.now() - RATE_LIMIT.windowMinutes * 60_000).toISOString();
  const { data: recent } = await relay
    .from("phone_uploads").select("sent_at").eq("token", token).gte("sent_at", since);
  const rate = rateVerdict((recent || []).map((r: any) => r.sent_at), new Date().toISOString());
  if (!rate.ok) return refuse("rate", 429);

  // ---- o arquivo em si, não o que ele diz ser ----
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = (file.type || "").toLowerCase();
  const fileCheck = uploadVerdict({ mime_type: mime, size: buf.byteLength });
  if (!fileCheck.ok) return refuse(fileCheck.reason);

  const direction = directionFor(link, form.get("direction"));
  const hash = createHash("sha256").update(buf).digest("hex");
  const sentAt = new Date().toISOString();
  const filename = captureFilename(uploadId, mime, sentAt);
  const storagePath = `${link.client_id}/${filename}`;

  const up = await relay.storage.from(RELAY_BUCKET)
    .upload(storagePath, buf, { contentType: mime, upsert: true });
  if (up.error) return refuse("storage", 500);

  const noteRaw = form.get("note");
  const note = typeof noteRaw === "string" ? noteRaw.trim().slice(0, NOTE_LIMIT) : null;

  const ins = await relay.from("phone_uploads").insert({
    upload_id: uploadId, token, client_id: link.client_id, direction,
    person: link.person, note: note || null,
    filename, mime_type: mime, size_bytes: buf.byteLength,
    content_hash: hash, storage_path: storagePath, sent_at: sentAt,
  });
  if (ins.error) {
    // Corrida de duas retentativas simultâneas: o índice único do upload_id é
    // que garante, e o código só precisa não chamar isso de falha.
    if ((ins.error as any).code === "23505") {
      return NextResponse.json({ ok: true, already: true });
    }
    // A linha não entrou, então o arquivo não pode ficar: sem linha, ninguém
    // vai buscá-lo nem apagá-lo, e ele fica na nuvem para sempre.
    await relay.storage.from(RELAY_BUCKET).remove([storagePath]);
    return refuse("server", 500);
  }

  await relay.from("phone_links").update({ last_used_at: sentAt }).eq("token", token);

  return NextResponse.json({ ok: true, already: false });
}
