/**
 * Entrada por telefone (camada B4) — as decisões, sem rede.
 *
 * O caso que motivou: o cliente do escritório está no posto de combustível, tira
 * foto da nota e ela precisa chegar na fila do analista. Como o servidor do
 * escritório é local e não é alcançável de fora, a captura é servida pela nuvem,
 * que guarda o arquivo até o servidor buscar e apagar.
 *
 * Quem envia NÃO é usuário do sistema — é cliente do escritório. Ele recebe um
 * link próprio e não tem senha. A razão não é conveniência: este token **não lê
 * nada**. Senha protege leitura, e aqui não há leitura para proteger. O pior caso
 * de um link vazado é foto de lixo na fila, que o analista descarta, e não
 * vazamento da contabilidade — então cobrar senha de um dono de loja no posto
 * custaria a praticidade inteira para comprar quase nada.
 *
 * O que este arquivo NÃO faz: rede, banco, armazenamento. Só decide. É a mesma
 * ordem das camadas B1 e B2 — decisão com teste primeiro, encanamento depois.
 */

/** A mesma direção da B2; a fila e o índice de duplicata são compartilhados. */
export type PhoneDirection = "purchase" | "sale";

/**
 * O link de um remetente.
 *
 * É **por pessoa**, não por cliente: o motorista e o dono da loja mandam pelo
 * mesmo cliente, e quando um telefone se perde você revoga só aquele link.
 */
export interface PhoneLink {
  token: string;
  client_id: string;
  /** Quem é, para o analista saber de quem veio. Não é login. */
  person: string;
  active: boolean;
  /**
   * Data em que o link para de valer (ISO, só a data).
   *
   * Existe porque revogar de verdade depende do escritório lembrar, e link de
   * telefone de ex-funcionário é o que mais fica esquecido. `null` = sem prazo.
   */
  expires_at: string | null;
  /**
   * Se este link pode mandar documento de VENDA.
   *
   * Padrão é não: quem fotografa nota no posto está registrando custo, e pedir
   * para ele classificar é devolver ao cliente o trabalho do analista.
   */
  allow_sale: boolean;
}

export type LinkVerdict =
  | { ok: true; link: PhoneLink }
  | { ok: false; reason: "unknown" | "inactive" | "expired" };

/**
 * O link serve agora?
 *
 * Recusa por motivo separado de propósito: "não existe" e "venceu" pedem
 * respostas diferentes na tela do cliente — a segunda ele resolve pedindo um
 * link novo, a primeira significa que ele colou algo errado.
 */
export function linkVerdict(link: PhoneLink | null | undefined, todayIso: string): LinkVerdict {
  if (!link) return { ok: false, reason: "unknown" };
  if (!link.active) return { ok: false, reason: "inactive" };
  if (link.expires_at && link.expires_at < todayIso) return { ok: false, reason: "expired" };
  return { ok: true, link };
}

/**
 * A direção do documento, com a do link mandando.
 *
 * O telefone pede, o link decide. Um pedido adulterado não consegue jogar um
 * custo na aba de vendas — que mexeria no VAT a pagar — porque quando o link não
 * permite venda, nada do que vier no pedido é considerado.
 */
export function directionFor(link: PhoneLink, requested: unknown): PhoneDirection {
  if (!link.allow_sale) return "purchase";
  return requested === "sale" ? "sale" : "purchase";
}

/** Comprimento do token do link. */
export const PHONE_TOKEN_LEN = 12;

const TOKEN_RE = /^[a-z0-9]{12}$/;

/**
 * O token tem a forma certa?
 *
 * Confere antes de ir ao banco para que uma URL colada errada não vire consulta.
 * É opaco pelo mesmo motivo da B2: o link vai por WhatsApp, e `?cliente=7`
 * contaria a quem recebe quantos clientes o escritório tem.
 */
export function isTokenShape(raw: unknown): boolean {
  return typeof raw === "string" && TOKEN_RE.test(raw);
}

/** Os mesmos tipos que a tela de leitura aceita — a foto passa pelo mesmo leitor. */
export const ACCEPTED_MIME = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

/**
 * Teto de um envio.
 *
 * Não é escolha estética: a Vercel corta o corpo de uma requisição em 4,5 MB, e
 * foto de telefone moderno passa disso sozinha. Por isso a tela reduz a imagem
 * antes de enviar — o que também faz o envio terminar rápido no 4G, que é onde
 * o cliente está quando fotografa. 4 MB deixa folga para o limite da plataforma.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Abaixo disto não é documento.
 *
 * Mesmo raciocínio da B2: foto de recibo passa de 100 KB com folga. Aqui o piso
 * pega o caso de a câmera devolver um arquivo truncado quando o sinal cai no
 * meio, que chegaria como imagem válida e ilegível.
 */
export const MIN_IMAGE_BYTES = 8 * 1024;

export interface UploadClaim {
  mime_type: unknown;
  size: unknown;
}

export type UploadVerdict =
  | { ok: true }
  | { ok: false; reason: "type" | "too_big" | "too_small" | "no_size" };

/**
 * O arquivo pode entrar?
 *
 * Recusa aqui é recusa antes de gravar: a nuvem é passagem, e arquivo que não
 * vai virar documento não deve nem ocupar lugar nela.
 */
export function uploadVerdict(claim: UploadClaim): UploadVerdict {
  const mime = typeof claim.mime_type === "string" ? claim.mime_type.toLowerCase() : "";
  if (!ACCEPTED_MIME.includes(mime)) return { ok: false, reason: "type" };

  const size = typeof claim.size === "number" && Number.isFinite(claim.size) ? claim.size : null;
  if (size === null || size <= 0) return { ok: false, reason: "no_size" };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_big" };
  // O piso não vale para PDF: PDF de texto puro pode ser legitimamente pequeno.
  if (mime !== "application/pdf" && size < MIN_IMAGE_BYTES) return { ok: false, reason: "too_small" };

  return { ok: true };
}

/** Quantos envios um link pode fazer, e em quanto tempo. */
export const RATE_LIMIT = { max: 40, windowMinutes: 10 };

export type RateVerdict = { ok: true; used: number } | { ok: false; used: number };

/**
 * O link passou do limite de envios?
 *
 * Existe por causa do que o token não protege: ele vai na URL, logo no histórico
 * do navegador e na mensagem de WhatsApp. Sem teto, um link vazado é um jeito de
 * entupir o armazenamento do escritório. A janela é curta e o teto é alto o
 * bastante para quem chega com a sacola de notas do mês e fotografa uma a uma.
 */
export function rateVerdict(recentIso: string[], nowIso: string): RateVerdict {
  const now = Date.parse(nowIso);
  const floor = now - RATE_LIMIT.windowMinutes * 60_000;
  // Data ilegível conta como dentro da janela: na dúvida, limita. O contrário
  // faria de um carimbo corrompido a maneira de furar o teto.
  const used = recentIso.filter((iso) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? true : t >= floor;
  }).length;
  return used >= RATE_LIMIT.max ? { ok: false, used } : { ok: true, used };
}

/**
 * Nome do arquivo guardado.
 *
 * Não reaproveita o nome que o telefone manda: câmera de iPhone chama tudo de
 * `image.jpg`, e nome vindo de fora é caminho para atravessar diretório. O nome
 * é montado a partir do que já é confiável — quem enviou, quando, e o id do
 * envio, que é único por natureza.
 */
export function captureFilename(uploadId: string, mime: string, sentAtIso: string): string {
  const ext = mime === "application/pdf" ? "pdf"
    : mime === "image/png" ? "png"
    : mime === "image/webp" ? "webp"
    : "jpg";
  const day = /^\d{4}-\d{2}-\d{2}/.test(sentAtIso) ? sentAtIso.slice(0, 10) : "sem-data";
  const safeId = String(uploadId).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40) || "sem-id";
  return `telefone-${day}-${safeId}.${ext}`;
}

/**
 * Descrição que o analista lê na fila.
 *
 * Diz **quem** mandou, porque na fila do escritório uma foto de recibo de posto
 * sem remetente é indistinguível da seguinte. A nota que o cliente escreve na
 * tela entra depois, e é cortada: campo livre de telefone recebe romance.
 */
export const NOTE_LIMIT = 300;

export function captureDescription(person: string, note: unknown): string {
  const who = String(person || "").trim() || "remetente não identificado";
  const raw = typeof note === "string" ? note.trim() : "";
  if (!raw) return `Enviado do telefone por ${who}.`;
  const cut = raw.length > NOTE_LIMIT ? raw.slice(0, NOTE_LIMIT).trimEnd() + "…" : raw;
  return `Enviado do telefone por ${who}: ${cut}`;
}
