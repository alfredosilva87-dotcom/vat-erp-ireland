import "server-only";
import { randomBytes } from "crypto";
import { getServerSupabase } from "@/lib/supabase";
import { configSmtp } from "./envioPuro";

/**
 * Levar a fatura ao destinatário: link, e-mail e WhatsApp.
 *
 * ---------------------------------------------------------------------------
 * O QUE DÁ MESMO PARA FAZER, E O QUE SE FINGE QUE DÁ
 *
 * **E-mail** envia a sério, com o PDF anexado, por SMTP. Precisa das variáveis
 * `MAIL_SMTP_*`; sem elas a rota RECUSA com uma mensagem que diz o que falta,
 * em vez de responder "enviado" e não enviar nada.
 *
 * **WhatsApp** não envia anexos sem a API de negócio da Meta — que exige conta
 * aprovada, número dedicado e custo por mensagem. O que se faz aqui é o que um
 * escritório pequeno usa de facto: abrir a conversa com o texto pronto e um
 * LINK para o PDF. Chamar a isto "enviar por WhatsApp" seria mentir; a tela
 * diz que abre a conversa.
 * ---------------------------------------------------------------------------
 */

/**
 * O endereço público da fatura.
 *
 * 32 bytes em base64url. Não é um id sequencial nem um uuid do banco: quem
 * recebe o link de uma fatura não deve conseguir adivinhar o da seguinte, e um
 * uuid v4 exposto liga a fatura a uma linha do banco sem necessidade.
 */
export async function criarLinkDeFatura(
  clientId: string, invoiceId: string
): Promise<{ ok: boolean; token?: string; erro?: string }> {
  const sb = getServerSupabase();
  const { data: inv } = await sb.from("issued_invoices")
    .select("status,share_token").eq("id", invoiceId).eq("client_id", clientId).maybeSingle();
  if (!inv) return { ok: false, erro: "Fatura não encontrada." };

  // Um rascunho não se partilha: ainda não tem número e ainda muda de valor.
  if ((inv as any).status === "draft") {
    return { ok: false, erro: "Emita a fatura antes de a partilhar." };
  }
  // Reusar o token que já existe mantém o link antigo a funcionar. Gerar um
  // novo a cada partilha partia o endereço que já tinha sido enviado.
  if ((inv as any).share_token) return { ok: true, token: (inv as any).share_token };

  const token = randomBytes(32).toString("base64url");
  const { error } = await sb.from("issued_invoices")
    .update({ share_token: token, share_created_at: new Date().toISOString() })
    .eq("id", invoiceId).eq("client_id", clientId);
  if (error) return { ok: false, erro: error.message };
  return { ok: true, token };
}

export async function revogarLinkDeFatura(
  clientId: string, invoiceId: string
): Promise<{ ok: boolean; erro?: string }> {
  const sb = getServerSupabase();
  const { error } = await sb.from("issued_invoices")
    .update({ share_token: null, share_created_at: null })
    .eq("id", invoiceId).eq("client_id", clientId);
  return error ? { ok: false, erro: error.message } : { ok: true };
}

/** A fatura por trás de um token, para a rota pública. Sem token não há nada. */
export async function invoicePorToken(token: string): Promise<{ clientId: string; invoiceId: string } | null> {
  if (!token || token.length < 20) return null;
  const sb = getServerSupabase();
  const { data } = await sb.from("issued_invoices")
    .select("id,client_id,status").eq("share_token", token).maybeSingle();
  if (!data) return null;
  // Anular a fatura fecha o link sem ser preciso lembrar de o revogar.
  if ((data as any).status === "cancelled") return null;
  return { clientId: (data as any).client_id, invoiceId: (data as any).id };
}

// ------------------------------------------------------------------ e-mail

export async function enviarPorEmail(d: {
  para: string;
  assunto: string;
  corpo: string;
  anexo: { nome: string; bytes: Buffer };
  responderA?: string | null;
}): Promise<{ ok: boolean; erro?: string }> {
  const cfg = configSmtp();
  if (!cfg.ok) {
    return {
      ok: false,
      erro: `O envio por e-mail ainda não está configurado — faltam ${cfg.faltam.join(", ")} `
        + "nas variáveis de ambiente. Entretanto dá para descarregar o PDF e anexá-lo, ou partilhar o link.",
    };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.para.trim())) {
    return { ok: false, erro: "O endereço de e-mail não parece válido." };
  }

  const nodemailer = await import("nodemailer");
  const t = nodemailer.createTransport({
    host: cfg.cfg.host, port: cfg.cfg.port, secure: cfg.cfg.secure,
    auth: { user: cfg.cfg.user, pass: cfg.cfg.pass },
  });

  try {
    await t.sendMail({
      from: cfg.cfg.from,
      to: d.para.trim(),
      // A resposta vai para o CLIENTE e não para o escritório: quem recebe a
      // fatura quer falar com quem a emitiu.
      replyTo: d.responderA?.trim() || undefined,
      subject: d.assunto,
      text: d.corpo,
      attachments: [{ filename: d.anexo.nome, content: d.anexo.bytes, contentType: "application/pdf" }],
    });
    return { ok: true };
  } catch (e: any) {
    // A mensagem crua do servidor de correio diz mais do que qualquer tradução
    // ("mailbox unavailable", "authentication failed") — e é o que se cola num
    // motor de busca quando não se percebe.
    return { ok: false, erro: `O servidor de correio recusou: ${e?.message || e}` };
  }
}

// ---------------------------------------------------------------- whatsapp

// As puras vivem em envioPuro.ts, que se compila sozinho para os testes.
export { telefoneParaWhatsapp, linkDeWhatsapp, configSmtp, type ConfigSmtp } from "./envioPuro";
