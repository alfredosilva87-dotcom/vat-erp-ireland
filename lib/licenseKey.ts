/**
 * Chave de licença assinada — gerar sem entrar no sistema do cliente.
 *
 * O desenho anterior tinha um defeito de fluxo, não de código: a chave era um
 * texto aleatório GRAVADO NO BANCO DO CLIENTE (`companies.pending_license_key`),
 * e a ativação só comparava o que o admin digitou com a cópia guardada. A chave
 * não carregava informação nenhuma — logo, para liberar um cliente era preciso
 * primeiro escrever no banco dele, ou seja, **entrar na instalação dele**. Num
 * produto self-hosted na rede do cliente, isso é justamente o que não se pode
 * fazer.
 *
 * Aqui a chave carrega a própria verdade e vem **assinada**:
 *
 *     VATERP1.<carga em base64url>.<assinatura em base64url>
 *
 * A carga diz para quem é (slug da empresa), até quando vale, quando foi emitida
 * e um identificador. A assinatura é Ed25519, feita com a chave PRIVADA que fica
 * com quem vende. A instalação do cliente só tem a chave **pública** embutida, e
 * com ela consegue conferir a assinatura mas nunca produzir uma nova.
 *
 * Por que assimétrico e não um segredo compartilhado: com segredo compartilhado,
 * o segredo teria de estar dentro da instalação do cliente para ela poder
 * conferir — e quem tem o segredo emite licença para si mesmo. A conta é simples:
 * o que está na máquina do cliente é do cliente.
 *
 * Ed25519 vem no `crypto` do Node. Nenhuma dependência nova.
 */

import { createPublicKey, sign as cryptoSign, verify as cryptoVerify } from "crypto";

export const KEY_PREFIX = "VATERP1";

export interface LicensePayload {
  /** Versão do formato. */
  v: 1;
  /** Slug da empresa a que a licença pertence. */
  c: string;
  /** Nome da empresa, só para a tela poder confirmar em voz alta para quem é. */
  n?: string;
  /** Validade, yyyy-mm-dd inclusive. */
  e: string;
  /** Data de emissão, yyyy-mm-dd. */
  i: string;
  /** Identificador da licença, para o histórico distinguir duas emissões. */
  id: string;
}

const b64url = {
  encode: (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  decode: (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
};

/**
 * A chave pública que confere as licenças.
 *
 * Fica no código de propósito — chave pública é pública, e embutir evita que
 * uma instalação sem configurar aceite qualquer licença por engano. A variável de
 * ambiente existe para teste e para o dia em que a chave for trocada, sem exigir
 * recompilar.
 */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAslswXLzVeh8LAZ9sqRM90Iqr2WP36Zd+ClphnFF8auA=
-----END PUBLIC KEY-----`;

function publicKeyPem(): string | null {
  const fromEnv = String(process.env.LICENSE_PUBLIC_KEY || "").trim();
  if (fromEnv) return fromEnv.includes("BEGIN") ? fromEnv : pemWrap(fromEnv);
  if (LICENSE_PUBLIC_KEY_PEM.includes("PLACEHOLDER")) return null;
  return LICENSE_PUBLIC_KEY_PEM;
}

/** Aceita a chave pública em base64 puro, para caber numa variável de ambiente. */
function pemWrap(base64: string): string {
  const body = base64.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

/** O que é assinado: a carga canônica, nunca o texto que o usuário colou. */
export function canonical(payload: LicensePayload): Buffer {
  // Ordem fixa das chaves. Assinar `JSON.stringify(obj)` cru deixaria a
  // verificação depender da ordem em que as chaves foram escritas, e duas
  // versões do emissor produziriam assinaturas incompatíveis para a mesma
  // licença.
  const ordered = { v: payload.v, c: payload.c, n: payload.n ?? "", e: payload.e, i: payload.i, id: payload.id };
  return Buffer.from(JSON.stringify(ordered), "utf8");
}

/** Emite a chave. Só quem tem a chave privada consegue. */
export function issueLicenseKey(payload: LicensePayload, privateKeyPem: string): string {
  const body = canonical(payload);
  const sig = cryptoSign(null, body, privateKeyPem);
  return `${KEY_PREFIX}.${b64url.encode(body)}.${b64url.encode(sig)}`;
}

export type VerifyResult =
  | { ok: true; payload: LicensePayload }
  | { ok: false; error: string };

/**
 * Confere a chave colada.
 *
 * Cada recusa diz o motivo em linguagem de quem está na tela, porque "chave
 * inválida" obriga a pessoa a adivinhar entre "digitei errado", "é de outra
 * empresa" e "está vencida" — três problemas com três consertos diferentes.
 */
export function verifyLicenseKey(raw: string): VerifyResult {
  const pem = publicKeyPem();
  if (!pem) {
    return { ok: false, error: "Esta instalação não tem chave pública de licença embutida." };
  }

  const text = String(raw || "").trim().replace(/\s+/g, "");
  const parts = text.split(".");
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) {
    return { ok: false, error: "Isto não parece uma chave de licença. Ela começa com VATERP1 e tem três partes separadas por ponto." };
  }

  let payload: LicensePayload;
  try {
    payload = JSON.parse(b64url.decode(parts[1]).toString("utf8"));
  } catch {
    return { ok: false, error: "A chave está truncada ou foi alterada — copie novamente, inteira." };
  }
  if (payload?.v !== 1 || !payload.c || !payload.e || !payload.id) {
    return { ok: false, error: "Formato de licença não reconhecido por esta versão do sistema." };
  }

  let valid = false;
  try {
    valid = cryptoVerify(null, canonical(payload), createPublicKey(pem), b64url.decode(parts[2]));
  } catch {
    valid = false;
  }
  // Assinatura inválida é o caso em que NÃO se explica demais: dizer o que
  // exatamente falhou ajudaria quem está tentando forjar.
  if (!valid) return { ok: false, error: "A assinatura desta chave não confere." };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.e)) {
    return { ok: false, error: "A data de validade da chave está em formato inválido." };
  }

  return { ok: true, payload };
}

/**
 * A chave serve para ESTA instalação, hoje?
 *
 * Separado da conferência de assinatura de propósito: a assinatura é sobre a
 * chave, e isto é sobre o encaixe dela aqui. Quem chama pode querer conferir a
 * assinatura sem aplicar (para mostrar na tela de quem é e até quando vale).
 */
export function checkFit(
  payload: LicensePayload,
  companySlug: string,
  currentExpiry: string | null,
  today = new Date().toISOString().slice(0, 10)
): { ok: true } | { ok: false; error: string } {
  if (payload.c.toLowerCase() !== companySlug.toLowerCase()) {
    return { ok: false, error: `Esta chave foi emitida para “${payload.c}”, e esta instalação é de “${companySlug}”.` };
  }
  if (payload.e < today) {
    return { ok: false, error: `Esta chave venceu em ${payload.e}. Peça uma nova.` };
  }
  // Aplicar uma chave mais curta que a atual encurtaria a licença sem ninguém
  // pedir — quase sempre é uma chave antiga reencontrada numa caixa de e-mail.
  if (currentExpiry && payload.e < currentExpiry) {
    return { ok: false, error: `A licença atual vale até ${currentExpiry}, mais que esta chave (${payload.e}). Nada foi alterado.` };
  }
  return { ok: true };
}

/** A carga de uma licença de N meses a partir de hoje. */
export function buildPayload(input: {
  slug: string; name?: string; months: number; id: string; today?: string;
}): LicensePayload {
  const base = input.today ? new Date(`${input.today}T00:00:00Z`) : new Date();
  const expires = new Date(base);
  expires.setUTCMonth(expires.getUTCMonth() + input.months);
  return {
    v: 1,
    c: input.slug.toLowerCase(),
    n: input.name,
    e: expires.toISOString().slice(0, 10),
    i: base.toISOString().slice(0, 10),
    id: input.id,
  };
}
