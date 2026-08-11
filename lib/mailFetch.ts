/**
 * A busca IMAP (camada B2).
 *
 * O servidor **busca**, não recebe. Ele roda na rede do escritório sem exposição
 * à internet, então receber SMTP exigiria abrir porta e publicar MX apontando
 * para dentro — e a caixa deixaria de ser do escritório para virar um serviço
 * exposto. Buscando, a caixa continua sendo a do escritório e nenhuma porta é
 * aberta.
 *
 * As decisões de o que entra estão em `lib/mailIngest.ts`, puras e testadas. O
 * que este arquivo faz é conversar com o servidor de e-mail e gravar o resultado.
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  bodyDescription, matchRoute, safeFilename, selectAttachments, senderVerdict,
  type IncomingMail, type MailRoute, type SenderRule,
} from "@/lib/mailIngest";
import {
  addInboxItem, finishMailFetch, listMailRoutes, listMailSenders, startMailFetch,
} from "@/lib/mailStore";
import { getServerSupabase } from "@/lib/supabase";

/**
 * A senha da caixa vem do ambiente, nunca do banco e nunca de um campo na tela.
 *
 * Um despejo do banco não pode carregar a senha da caixa de e-mail do escritório
 * junto com as notas — e um campo na tela seria exatamente o "guardar credencial
 * de terceiro" que o plano recusou no caso dos portais de fornecedor.
 */
export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
  /** O endereço base, só para a tela poder mostrar `notas+token@dominio`. */
  inboxAddress: string | null;
}

export function readMailConfig(): { config?: MailConfig; missing: string[] } {
  const need = ["MAIL_IMAP_HOST", "MAIL_IMAP_USER", "MAIL_IMAP_PASSWORD"];
  const missing = need.filter((k) => !String(process.env[k] ?? "").trim());
  if (missing.length) return { missing };
  return {
    missing: [],
    config: {
      host: String(process.env.MAIL_IMAP_HOST).trim(),
      port: Number(process.env.MAIL_IMAP_PORT || 993),
      // Só desliga TLS quem escreveu explicitamente que quer isso. O padrão
      // nunca pode ser a senha da caixa viajando em claro pela rede.
      secure: String(process.env.MAIL_IMAP_SECURE ?? "true").toLowerCase() !== "false",
      user: String(process.env.MAIL_IMAP_USER).trim(),
      password: String(process.env.MAIL_IMAP_PASSWORD),
      mailbox: String(process.env.MAIL_IMAP_MAILBOX || "INBOX").trim(),
      inboxAddress: String(process.env.MAIL_INBOX_ADDRESS || "").trim() || null,
    },
  };
}

/**
 * Quantas mensagens uma busca processa.
 *
 * Um limite existe porque a primeira busca de uma caixa que nunca foi lida pode
 * encontrar milhares de mensagens, e uma rota de servidor que roda por vinte
 * minutos morre no meio sem deixar claro o que entrou. O que ficou de fora é
 * **contado e dito** — silêncio aqui leria como "chegou tudo".
 */
export const FETCH_LIMIT = 50;

export interface FetchOutcome {
  fetch_id: string | null;
  seen: number;
  accepted: number;
  refused: number;
  duplicate: number;
  /** Mensagens que ficaram para a próxima busca por causa do limite. */
  remaining: number;
  error: string | null;
  /** Uma linha por mensagem, para a tela contar o que aconteceu. */
  log: { subject: string | null; sender: string | null; result: string }[];
}

const asArray = (v: unknown): string[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
};

/** Todos os destinatários que o e-mail carrega, de onde sai o token do cliente. */
function recipientsOf(parsed: any, deliveredTo: string[]): string[] {
  const out: string[] = [...deliveredTo];
  for (const field of ["to", "cc", "bcc"]) {
    const v = parsed[field];
    if (!v) continue;
    for (const a of asArray(v.value ? v.value.map((x: any) => x.address) : v.text)) out.push(a);
  }
  // O sub-endereçamento costuma sobreviver em Delivered-To e X-Original-To
  // mesmo quando o To foi reescrito por lista de distribuição.
  for (const h of ["delivered-to", "x-original-to", "x-forwarded-to"]) {
    const v = parsed.headers?.get?.(h);
    for (const a of asArray(typeof v === "string" ? v : (v as any)?.text)) out.push(a);
  }
  return out.filter(Boolean);
}

/**
 * Uma passada na caixa: busca o que não foi lido, roteia, guarda o que é
 * documento e marca a mensagem como lida.
 *
 * Nada aqui lança para o chamador. Uma caixa fora do ar, uma senha trocada ou um
 * e-mail malformado precisam virar registro e mensagem na tela — a rota que
 * devolve 500 com o texto do erro do socket não diz ao escritório o que fazer.
 */
export async function fetchMailOnce(): Promise<FetchOutcome> {
  const empty: FetchOutcome = {
    fetch_id: null, seen: 0, accepted: 0, refused: 0, duplicate: 0, remaining: 0, error: null, log: [],
  };

  const { config, missing } = readMailConfig();
  if (!config) {
    return { ...empty, error: `Entrada por e-mail não configurada. Falta no ambiente: ${missing.join(", ")}.` };
  }

  const routes: MailRoute[] = await listMailRoutes();
  const senders: SenderRule[] = await listMailSenders();
  const fetchId = await startMailFetch(config.mailbox);

  const counts = { seen: 0, accepted: 0, refused: 0, duplicate: 0 };
  const log: FetchOutcome["log"] = [];
  let remaining = 0;
  let error: string | null = null;

  const client = new ImapFlow({
    host: config.host, port: config.port, secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(config.mailbox);
    try {
      const unseen = await client.search({ seen: false });
      const uids = (unseen || []) as number[];
      const take = uids.slice(0, FETCH_LIMIT);
      remaining = Math.max(0, uids.length - take.length);

      for (const uid of take) {
        counts.seen++;
        let subject: string | null = null;
        let sender: string | null = null;
        try {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg || !(msg as any).source) {
            log.push({ subject: null, sender: null, result: "Mensagem não pôde ser baixada." });
            counts.refused++;
            continue;
          }
          const parsed: any = await simpleParser((msg as any).source);
          subject = parsed.subject ?? null;
          sender = parsed.from?.value?.[0]?.address ?? parsed.from?.text ?? null;

          const mail: IncomingMail = {
            message_id: parsed.messageId ?? null,
            from: sender,
            recipients: recipientsOf(parsed, []),
            subject,
            text: parsed.text ?? null,
            html: typeof parsed.html === "string" ? parsed.html : null,
            date: parsed.date ? new Date(parsed.date).toISOString() : null,
            attachments: (parsed.attachments ?? []).map((a: any) => ({
              filename: a.filename ?? null,
              mime_type: a.contentType ?? "application/octet-stream",
              size: a.size ?? (a.content?.length ?? 0),
              content_id: a.cid ?? null,
              disposition: a.contentDisposition ?? null,
            })),
          };

          const route = matchRoute(mail, routes);
          const verdict = route.route
            ? senderVerdict(mail.from, senders, route.route.client_id)
            : { ok: true, reason: "" };

          // Mensagem recusada NÃO guarda o anexo: guardar PDF de remetente
          // bloqueado é encher o disco com exatamente o que o bloqueio existe
          // para não receber.
          //
          // Remetente bloqueado também não deixa linha na fila — só o contador da
          // busca. O escritório já decidiu que não quer aquele remetente, e um
          // spammer que insiste toda semana entupiria a fila com avisos de algo
          // que está funcionando. Tudo o mais deixa linha COM o motivo, porque
          // pede decisão: recusa silenciosa é o que faria o escritório deixar de
          // confiar na entrada automática.
          if (!route.route || !verdict.ok) {
            const reason = route.refusal || verdict.reason;
            const blocked = Boolean(route.route) && !verdict.ok;
            if (!blocked) await recordRefusal(fetchId, mail, reason);
            counts.refused++;
            log.push({ subject, sender, result: reason });
            continue;
          }

          const decisions = selectAttachments(mail);
          const keep = decisions.filter((d) => d.keep);
          if (!keep.length) {
            const why = decisions.length
              ? `Nenhum anexo aproveitável (${decisions.map((d) => d.reason).filter(Boolean).join("; ")}).`
              : "Mensagem sem anexo.";
            await recordRefusal(fetchId, mail, why, route.route.client_id, route.route.direction);
            counts.refused++;
            log.push({ subject, sender, result: why });
            continue;
          }

          const body = bodyDescription(mail);
          let added = 0, dup = 0;
          for (let i = 0; i < decisions.length; i++) {
            const d = decisions[i];
            if (!d.keep) continue;
            const source = (parsed.attachments ?? [])[i];
            const bytes: Buffer | null = source?.content ? Buffer.from(source.content) : null;
            if (!bytes?.length) continue;

            const res = await addInboxItem({
              client_id: route.route.client_id,
              direction: route.route.direction,
              fetch_id: fetchId,
              sender: mail.from,
              subject: mail.subject,
              body,
              received_at: mail.date,
              message_id: mail.message_id,
              filename: safeFilename(d.attachment, i),
              mime_type: d.attachment.mime_type,
              bytes,
            });
            if (res.kind === "added") added++;
            else if (res.kind === "duplicate") dup++;
          }

          counts.accepted += added;
          counts.duplicate += dup;
          log.push({
            subject, sender,
            result: added
              ? `${added} anexo(s) na fila${dup ? `, ${dup} já estava(m)` : ""}.`
              : `${dup} anexo(s) já estava(m) na fila — reenvio do mesmo arquivo.`,
          });
        } catch (e: any) {
          // Uma mensagem estragada não pode derrubar a busca inteira: as outras
          // quarenta e nove continuam valendo.
          counts.refused++;
          log.push({ subject, sender, result: `Erro ao ler a mensagem: ${e?.message || e}` });
        } finally {
          // Marcada como lida mesmo quando recusada, senão toda busca reprocessa
          // a mesma mensagem para sempre e o contador de recusas cresce sem fim.
          try { await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); } catch { /* volta na próxima */ }
        }
      }
    } finally {
      lock.release();
    }
  } catch (e: any) {
    error = friendlyImapError(e);
  } finally {
    try { await client.logout(); } catch { /* já caiu */ }
  }

  await finishMailFetch(fetchId, counts, error);
  return { fetch_id: fetchId, ...counts, remaining, error, log };
}

/** Uma linha na fila para o que não entrou, com o motivo. */
async function recordRefusal(
  fetchId: string, mail: IncomingMail, reason: string,
  clientId: string | null = null, direction: any = null
): Promise<void> {
  await getServerSupabase().from("inbox_items").insert({
    client_id: clientId,
    direction,
    fetch_id: fetchId,
    source: "email",
    sender: mail.from,
    subject: mail.subject,
    body: bodyDescription(mail),
    received_at: mail.date,
    message_id: mail.message_id,
    status: "refused",
    refused_reason: reason,
  });
}

/**
 * O erro do IMAP em português, dizendo o que fazer.
 *
 * "AUTHENTICATIONFAILED" na tela é o mesmo que não dizer nada: quem configurou
 * não sabe se errou a senha, se o provedor exige senha de aplicativo, ou se o
 * servidor está fora do ar.
 */
function friendlyImapError(e: any): string {
  const msg = String(e?.message || e || "");
  const code = String(e?.code || "");
  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed/i.test(msg)) {
    return "O servidor de e-mail recusou o login. Confira MAIL_IMAP_USER e MAIL_IMAP_PASSWORD — Gmail e Microsoft 365 exigem senha de aplicativo, não a senha da conta.";
  }
  if (code === "ENOTFOUND" || /getaddrinfo/i.test(msg)) {
    return "Servidor de e-mail não encontrado. Confira MAIL_IMAP_HOST.";
  }
  if (code === "ECONNREFUSED") return "Conexão recusada pelo servidor de e-mail. Confira a porta (MAIL_IMAP_PORT, normalmente 993).";
  if (code === "ETIMEDOUT" || /timeout/i.test(msg)) return "O servidor de e-mail não respondeu. Pode ser bloqueio de firewall na saída da rede.";
  if (/NONEXISTENT|Mailbox doesn't exist/i.test(msg)) return "A pasta configurada em MAIL_IMAP_MAILBOX não existe nessa caixa.";
  return msg || "Falha ao buscar e-mail.";
}
