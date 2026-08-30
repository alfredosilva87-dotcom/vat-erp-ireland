/**
 * As partes do envio que não falam com nada: telefone, link e configuração.
 *
 * Vive separado de `envio.ts` porque aquele é `server-only` — fala com o banco
 * e com o servidor de correio. Estas três funções não falam com ninguém, e são
 * justamente as que precisam de teste: um número de telefone mal convertido não
 * dá erro, dá uma conversa aberta com OUTRA pessoa, e a fatura de um cliente vai
 * para o telefone de um desconhecido.
 */

/**
 * Só dígitos, com o indicativo. `+353 87 123 4567` → `353871234567`.
 *
 * Devolve `null` quando não dá para saber o país, e não um palpite: é o único
 * erro deste módulo com consequência para terceiros.
 */
export function telefoneParaWhatsapp(
  tel: string | null | undefined, indicativoPadrao = "353"
): string | null {
  if (!tel) return null;
  const n = String(tel).replace(/[^\d+]/g, "");
  if (!n) return null;

  if (n.startsWith("+")) return n.slice(1) || null;
  if (n.startsWith("00")) return n.slice(2) || null;
  // `087...` é o formato nacional irlandês: o zero da frente cai e entra o 353.
  if (n.startsWith("0")) return indicativoPadrao + n.slice(1);

  // Sem indicativo e sem zero não se adivinha. Um número tratado como irlandês
  // por engano manda a fatura para o telefone de um desconhecido.
  return n.length >= 11 ? n : null;
}

export function linkDeWhatsapp(telefone: string | null | undefined, mensagem: string): string {
  const n = telefoneParaWhatsapp(telefone);
  const texto = encodeURIComponent(mensagem);
  // Sem número, abre o WhatsApp com o texto pronto e a pessoa escolhe a
  // conversa — melhor do que não abrir nada quando falta o telefone.
  return n ? `https://wa.me/${n}?text=${texto}` : `https://wa.me/?text=${texto}`;
}

export type ConfigSmtp = {
  host: string; port: number; secure: boolean;
  user: string; pass: string; from: string;
};

/**
 * A configuração de SMTP, ou a lista do que falta.
 *
 * Devolve QUAIS variáveis faltam em vez de um booleano: "faltam MAIL_SMTP_USER
 * e MAIL_SMTP_PASSWORD" resolve-se sozinho, "e-mail não configurado" manda
 * alguém procurar em que ficheiro.
 */
export function configSmtp(): { ok: true; cfg: ConfigSmtp } | { ok: false; faltam: string[] } {
  const e = process.env;
  const faltam = ["MAIL_SMTP_HOST", "MAIL_SMTP_USER", "MAIL_SMTP_PASSWORD"]
    .filter((k) => !e[k]?.trim());
  if (faltam.length) return { ok: false, faltam };

  const port = Number(e.MAIL_SMTP_PORT || 587);
  return {
    ok: true,
    cfg: {
      host: e.MAIL_SMTP_HOST!.trim(),
      port,
      // 465 é sempre TLS implícito; 587 é STARTTLS. Adivinhar pelo porto evita
      // a variável a mais que toda a gente esquece de pôr.
      secure: e.MAIL_SMTP_SECURE ? e.MAIL_SMTP_SECURE === "true" : port === 465,
      user: e.MAIL_SMTP_USER!.trim(),
      pass: e.MAIL_SMTP_PASSWORD!,
      from: (e.MAIL_SMTP_FROM || e.MAIL_SMTP_USER)!.trim(),
    },
  };
}
