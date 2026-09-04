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

/**
 * De QUEM sai o recibo de vencimento, e para quem vai a resposta.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO SERVE O REMETENTE DO SMTP
 *
 * `MAIL_SMTP_USER` é a conta que AUTENTICA no servidor de correio — muitas
 * vezes uma caixa técnica (`noreply@`, ou a conta do domínio). Um trabalhador
 * que recebe o recibo e carrega em responder quer falar com quem trata da
 * folha, e não com uma caixa que ninguém lê.
 *
 * São duas variáveis e não uma porque o escritório são duas pessoas: o Alfredo
 * e o sócio. Sai de um endereço da casa, e a resposta pode ir para outro — ou
 * para os dois, que `MAIL_PAYSLIP_REPLY_TO` aceita separados por vírgula, como
 * qualquer cabeçalho de correio.
 *
 * Nenhuma é obrigatória: sem elas o recibo sai do mesmo sítio de que já saíam
 * as faturas, que é o comportamento que já existia.
 * ---------------------------------------------------------------------------
 *
 *   MAIL_PAYSLIP_FROM      quem aparece como remetente (cai em MAIL_SMTP_FROM)
 *   MAIL_PAYSLIP_REPLY_TO  para onde vai a resposta   (cai em MAIL_PAYSLIP_FROM)
 */
export function enderecosDoRecibo(
  env: Record<string, string | undefined> = process.env
): { de: string | null; responderA: string | null } {
  const de = (env.MAIL_PAYSLIP_FROM || "").trim() || null;
  const responderA = (env.MAIL_PAYSLIP_REPLY_TO || "").trim() || de;
  return { de, responderA };
}

/**
 * Como o ficheiro da fatura se deve chamar.
 *
 * ---------------------------------------------------------------------------
 * O NÚMERO SOZINHO NÃO CHEGA
 *
 * `INV-2026-0001.pdf` diz tudo a quem está dentro do sistema e nada a quem não
 * está. Quem descarrega quatro faturas fica com quatro ficheiros que só se
 * distinguem pelo último dígito, e tem de abrir cada um para saber de quem é —
 * o mesmo problema que o ZIP do cofre de documentos já tinha resolvido.
 *
 * O número vem PRIMEIRO para os ficheiros ordenarem por sequência dentro da
 * pasta, que é como se procura uma fatura.
 * ---------------------------------------------------------------------------
 */
export function nomeDoFicheiro(
  numero: string, cliente: string | null | undefined, rascunho = false
): string {
  const base = rascunho ? "rascunho" : limparParaFicheiro(numero) || "fatura";
  const quem = limparParaFicheiro(cliente ?? "");
  return quem ? `${base} - ${quem}.pdf` : `${base}.pdf`;
}

/**
 * Um nome que sobrevive a Windows, Mac e Linux — e ao cabeçalho HTTP.
 *
 * O nome do cliente vem do cadastro, escrito por uma pessoa: pode ter barras,
 * dois pontos, acentos e aspas. `/` e `:` partem o caminho num sistema ou
 * noutro; e as ASPAS partem o próprio `Content-Disposition`, que é o cabeçalho
 * que decide o nome do ficheiro descarregado — um nome com aspas faria o
 * navegador guardar a fatura com um nome truncado, ou com o resto do cabeçalho
 * lá dentro.
 */
function limparParaFicheiro(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ._-]+/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 60);
}
