/**
 * Entrada por e-mail — as decisões (camada B2).
 *
 * O que esta camada compra: o endereço pode ser dado **direto ao fornecedor**.
 * Aí o cliente não faz nada, não tira foto, não entra no sistema — a fatura
 * chega sozinha e aparece na fila para o escritório revisar.
 *
 * **Onde a caixa vive.** O servidor roda na rede do escritório, sem exposição à
 * internet, então receber SMTP está fora de questão: exigiria abrir porta e
 * publicar MX apontando para dentro. O servidor **busca** por IMAP numa caixa
 * que é do escritório. A caixa não é de terceiro processador, o que mantém a
 * premissa de que dado nenhum sai.
 *
 * **Um endereço por cliente e por direção**, feito com sub-endereçamento
 * (`notas+a7k2f9@escritorio.ie`). Uma caixa só, e o pedaço depois do `+` diz de
 * quem é a nota e se é compra ou venda.
 *
 * Função pura de propósito: mensagem e configuração entram, decisão sai. Sem
 * rede e sem banco, para que cada regra abaixo seja testável e um e-mail
 * recusado por engano seja reproduzível.
 */

export type MailDirection = "purchase" | "sale";

export interface MailRoute {
  client_id: string;
  direction: MailDirection;
  /** O pedaço depois do `+`, minúsculo. */
  token: string;
  active: boolean;
}

/**
 * Quem pode mandar. `pattern` é um endereço inteiro (`ap@fornecedor.ie`) ou um
 * domínio (`@fornecedor.ie`) — nunca expressão regular: uma regex numa tabela de
 * regras é armadilha, porque um caractere errado transforma "só este remetente"
 * em "qualquer um" sem avisar.
 */
export interface SenderRule {
  pattern: string;
  mode: "allow" | "block";
  /** Nulo = vale para todos os clientes do escritório. */
  client_id: string | null;
}

export interface IncomingAttachment {
  filename: string | null;
  mime_type: string;
  size: number;
  /** Preenchido quando a imagem é referenciada pelo corpo (logo, assinatura). */
  content_id: string | null;
  /** "attachment" ou "inline", como o e-mail declarou. */
  disposition: string | null;
}

export interface IncomingMail {
  message_id: string | null;
  from: string | null;
  /** To + Cc + Delivered-To, tudo junto: o endereço do cliente pode estar em qualquer um. */
  recipients: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  date: string | null;
  attachments: IncomingAttachment[];
}

const lower = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Só o endereço, mesmo quando vem como `Fornecedor <ap@x.ie>`. */
export function addressOf(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const angled = /<([^>]+)>/.exec(s);
  return lower(angled ? angled[1] : s);
}

export const domainOf = (raw: unknown): string => {
  const at = addressOf(raw).lastIndexOf("@");
  return at < 0 ? "" : addressOf(raw).slice(at);
};

/**
 * O pedaço depois do `+`, que é o que identifica cliente e direção.
 *
 * Nulo quando o endereço não tem `+`: é o caso da mensagem que chegou na caixa
 * sem passar por um endereço de cliente (alguém escreveu para `notas@` direto),
 * e essa não deve ser adivinhada para cliente nenhum.
 */
export function routeTokenOf(raw: unknown): string | null {
  const addr = addressOf(raw);
  const at = addr.lastIndexOf("@");
  if (at <= 0) return null;
  const local = addr.slice(0, at);
  const plus = local.indexOf("+");
  if (plus < 0) return null;
  const token = local.slice(plus + 1).trim();
  return token || null;
}

export interface RouteMatch {
  route: MailRoute | null;
  /** O endereço que resolveu o roteamento, para o registro do que aconteceu. */
  matchedAddress: string | null;
  /** Preenchido quando a mensagem não pode ser roteada, e diz por quê. */
  refusal: string | null;
}

/**
 * De quem é esta mensagem.
 *
 * Duas mensagens de cliente diferente no mesmo e-mail não existem como uma coisa
 * só: os anexos são de um cliente ou de outro, e não há como saber de qual. Por
 * isso endereços de dois clientes na mesma mensagem é recusa explícita, não
 * escolha do primeiro — mesma razão do empate de regras de fornecedor na camada
 * B1: decidir no par ou ímpar coloca a nota de uma empresa dentro de outra.
 */
export function matchRoute(mail: IncomingMail, routes: MailRoute[]): RouteMatch {
  const active = routes.filter((r) => r.active !== false);
  const byToken = new Map<string, MailRoute>();
  for (const r of active) byToken.set(lower(r.token), r);

  const hits: { route: MailRoute; address: string }[] = [];
  for (const raw of mail.recipients ?? []) {
    const token = routeTokenOf(raw);
    if (!token) continue;
    const route = byToken.get(token);
    if (route && !hits.some((h) => h.route === route)) hits.push({ route, address: addressOf(raw) });
  }

  if (!hits.length) {
    return {
      route: null, matchedAddress: null,
      refusal: "Nenhum endereço de cliente reconhecido nos destinatários.",
    };
  }

  const clients = new Set(hits.map((h) => h.route.client_id + "/" + h.route.direction));
  if (clients.size > 1) {
    return {
      route: null, matchedAddress: null,
      refusal: `Endereços de mais de um destino na mesma mensagem (${hits.map((h) => h.address).join(", ")}) — não há como saber de quem é o anexo.`,
    };
  }

  return { route: hits[0].route, matchedAddress: hits[0].address, refusal: null };
}

export interface SenderVerdict {
  ok: boolean;
  /** Por que passou ou não, para o registro e para a tela. */
  reason: string;
}

/**
 * O remetente pode mandar?
 *
 * Ordem: **bloqueio ganha sempre**, e depois, se existir qualquer liberação para
 * este cliente, só remetente liberado passa. Bloqueio acima de liberação porque
 * quem bloqueia um remetente está corrigindo um problema que já aconteceu, e uma
 * liberação ampla escrita meses antes não pode desfazer isso em silêncio.
 *
 * Lista de liberação vazia significa **caixa aberta**, não caixa fechada: um
 * escritório que ligou a entrada por e-mail e ainda não cadastrou remetente
 * nenhum quer receber, não quer recusar tudo.
 */
export function senderVerdict(from: unknown, rules: SenderRule[], clientId: string | null): SenderVerdict {
  const addr = addressOf(from);
  const dom = domainOf(from);
  if (!addr) return { ok: false, reason: "Mensagem sem remetente." };

  const scoped = rules.filter((r) => r.client_id == null || r.client_id === clientId);
  const matches = (r: SenderRule) => {
    const p = lower(r.pattern);
    if (!p) return false;
    return p.startsWith("@") ? dom === p : addr === p;
  };

  const blocked = scoped.find((r) => r.mode === "block" && matches(r));
  if (blocked) return { ok: false, reason: `Remetente bloqueado (${blocked.pattern}).` };

  const allows = scoped.filter((r) => r.mode === "allow");
  if (!allows.length) return { ok: true, reason: "Sem lista de liberação — a caixa está aberta." };

  const allowed = allows.find(matches);
  return allowed
    ? { ok: true, reason: `Remetente liberado (${allowed.pattern}).` }
    : { ok: false, reason: "Remetente fora da lista de liberação deste cliente." };
}

// ------------------------------------------------------------- anexos

/** Os mesmos tipos que a tela de leitura aceita. */
export const ACCEPTED_MIME = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

/**
 * Abaixo disto, uma imagem é logo ou ícone, não documento.
 *
 * Foto de recibo tirada com telefone passa de 100 KB com folga; nem os PNG mais
 * enxutos de nota escaneada chegam perto de 8 KB. O limite não vale para PDF,
 * que pode legitimamente ser pequeno quando é só texto.
 */
export const MIN_IMAGE_BYTES = 8 * 1024;

export interface AttachmentDecision {
  attachment: IncomingAttachment;
  keep: boolean;
  /** Por que foi descartado. Fica no registro: some em silêncio é o que não pode. */
  reason: string | null;
}

/**
 * Quais anexos são documento.
 *
 * O erro que isto existe para evitar: **toda assinatura corporativa vem com o
 * logotipo como anexo**. Sem filtro, cada fatura da empresa que tem logo no pé
 * do e-mail cria dois itens na fila, um deles um PNG de 3 KB, e o escritório
 * passa a descartar lixo à mão todos os dias até desligar a entrada por e-mail.
 *
 * O sinal forte é o `Content-ID` com disposição `inline`: quem referencia a
 * imagem no corpo está usando ela como parte do texto. O tamanho pega o resto,
 * porque muita ferramenta manda o logo como anexo comum.
 */
export function selectAttachments(mail: IncomingMail): AttachmentDecision[] {
  return (mail.attachments ?? []).map((a) => {
    const mime = lower(a.mime_type);
    if (!ACCEPTED_MIME.includes(mime)) {
      return { attachment: a, keep: false, reason: `Tipo não aceito (${a.mime_type || "desconhecido"}).` };
    }
    const isImage = mime.startsWith("image/");
    if (isImage && a.content_id && lower(a.disposition) === "inline") {
      return { attachment: a, keep: false, reason: "Imagem embutida no corpo — logotipo ou assinatura." };
    }
    if (isImage && a.size < MIN_IMAGE_BYTES) {
      return { attachment: a, keep: false, reason: `Imagem pequena demais para ser documento (${a.size} bytes).` };
    }
    return { attachment: a, keep: true, reason: null };
  });
}

/**
 * Nome de arquivo seguro para guardar, com o tipo respeitado.
 *
 * Fora a barra (que faria o nome virar caminho), saem os caracteres de controle
 * e as aspas: este nome vai para o cabeçalho `Content-Disposition` na rota que
 * serve o anexo, e nova linha em valor de cabeçalho é o começo de injeção de
 * cabeçalho. O runtime do Node hoje recusa e devolve erro em vez de injetar, mas
 * a garantia não pode depender disso.
 */
export function safeFilename(a: IncomingAttachment, fallbackIndex: number): string {
  const raw = String(a.filename ?? "").trim().replace(/[\u0000-\u001f\u007f"/\\]+/g, "-").slice(-120);
  if (raw) return raw;
  const ext = lower(a.mime_type) === "application/pdf" ? "pdf" : lower(a.mime_type).split("/")[1] || "bin";
  return `anexo-${fallbackIndex + 1}.${ext}`;
}

// ------------------------------------------------------------- corpo

/** Até onde o corpo do e-mail vira descrição. */
export const BODY_LIMIT = 1000;

const stripTags = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

/**
 * O corpo do e-mail como descrição do que chegou.
 *
 * Vale a pena guardar porque é onde o fornecedor escreve o que a nota não diz
 * ("segue a fatura de julho, o crédito da devolução entra na próxima"). Sem
 * isso, o escritório vê o PDF sem o recado que veio com ele.
 *
 * A resposta citada é cortada: numa conversa de cinco trocas, o corpo inteiro é
 * quase todo repetição do que já foi lido, e o recado novo está nas primeiras
 * linhas.
 */
export function bodyDescription(mail: IncomingMail): string | null {
  const raw = mail.text && mail.text.trim() ? mail.text : mail.html ? stripTags(mail.html) : "";
  if (!raw.trim()) return null;

  const lines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    // Separador de assinatura, resposta citada, e o "Em ... escreveu:" que vem
    // antes dela em português, inglês e espanhol.
    if (t === "--" || t === "-- ") break;
    if (t.startsWith(">")) break;
    if (/^(em|on|el)\b.{0,80}\b(escreveu|wrote|escribió)\s*:?$/i.test(t)) break;
    if (/^-{3,}\s*(mensagem original|original message|forwarded message)/i.test(t)) break;
    lines.push(t);
  }

  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  if (!text) return null;
  return text.length > BODY_LIMIT ? text.slice(0, BODY_LIMIT).trimEnd() + "…" : text;
}
