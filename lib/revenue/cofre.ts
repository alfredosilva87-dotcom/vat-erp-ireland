/**
 * O COFRE DO CERTIFICADO DA REVENUE.
 *
 * ---------------------------------------------------------------------------
 * A DECISÃO QUE MAIS IMPORTA AQUI: A SENHA DO `.p12` NÃO É GUARDADA
 *
 * O ROS entrega o certificado num ficheiro PKCS#12 protegido por senha. O
 * caminho preguiçoso seria guardar o ficheiro e a senha, e abri-lo a cada
 * pedido. Isso põe uma credencial reutilizável na base de dados, e a senha do
 * `.p12` costuma ser a mesma que a pessoa usa no ROS.
 *
 * Em vez disso, a senha é usada UMA vez, no momento da importação, para tirar
 * de lá dentro o certificado e a chave privada. A partir daí a senha é deitada
 * fora e nunca mais é pedida — o que fica guardado é a chave, cifrada.
 *
 * Não é segurança perfeita: quem tiver a chave cifrada E a chave de cifra
 * consegue assinar. Mas separa as duas coisas, e um despejo da base de dados
 * sozinho deixa de chegar.
 *
 * ---------------------------------------------------------------------------
 * PORQUE A CHAVE DE CIFRA VEM DE UMA VARIÁVEL PRÓPRIA
 *
 * `REVENUE_CERT_KEY`, e não o `AUTH_SECRET`. São segredos com ciclos de vida
 * diferentes: o `AUTH_SECRET` roda-se quando se quer expulsar toda a gente das
 * sessões, e isso não pode, de repente, também deixar o escritório sem
 * conseguir correr a folha. Um segredo, uma responsabilidade.
 *
 * Sem a variável definida, isto RECUSA cifrar — em vez de guardar em claro e
 * ninguém dar por isso.
 *
 * ---------------------------------------------------------------------------
 * AES-256-GCM, E PORQUÊ
 *
 * GCM autentica além de cifrar: mexer num byte do texto cifrado faz a
 * decifragem falhar, em vez de devolver lixo que depois produziria uma
 * assinatura inválida e um `401` sem explicação. O IV vai junto porque tem de
 * ser diferente a cada cifragem e não é segredo.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

/**
 * A chave de 32 bytes, derivada do segredo do ambiente.
 *
 * SHA-256 do segredo: aceita um segredo de qualquer comprimento e dá sempre os
 * 32 bytes que o AES-256 quer. Não é um KDF com sal — e não precisa de ser,
 * porque isto não deriva de uma senha humana, deriva de um segredo já
 * aleatório gerado por quem instala.
 */
function chave(): Buffer {
  const segredo = process.env.REVENUE_CERT_KEY;
  if (!segredo || segredo.length < 16) {
    throw new Error(
      "REVENUE_CERT_KEY não está definida (ou é curta demais). " +
      "Sem ela o certificado da Revenue não pode ser guardado em segurança."
    );
  }
  return createHash("sha256").update(segredo).digest();
}

/** Há como guardar? A tela usa isto para explicar antes de deixar tentar. */
export function cofreConfigurado(): boolean {
  const s = process.env.REVENUE_CERT_KEY;
  return Boolean(s && s.length >= 16);
}

/**
 * Cifra. O formato é `iv.tag.texto`, tudo em base64url, numa linha só — cabe
 * numa coluna de texto e não obriga a três colunas que podem separar-se.
 */
export function cifrar(claro: string): string {
  const iv = randomBytes(12); // 96 bits, o tamanho que o GCM quer
  const c = createCipheriv(ALGO, chave(), iv);
  const dados = Buffer.concat([c.update(claro, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), dados.toString("base64url")].join(".");
}

/** Decifra. Texto adulterado ou chave errada dá erro, nunca lixo silencioso. */
export function decifrar(guardado: string): string {
  const partes = String(guardado ?? "").split(".");
  if (partes.length !== 3) throw new Error("Certificado guardado em formato inesperado.");
  const [ivB, tagB, dadosB] = partes;
  const d = createDecipheriv(ALGO, chave(), Buffer.from(ivB, "base64url"));
  d.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([d.update(Buffer.from(dadosB, "base64url")), d.final()]).toString("utf8");
}

/**
 * A impressão digital do certificado, para o ecrã poder dizer QUAL está lá
 * dentro sem nunca o mostrar.
 *
 * É o que permite ao escritório confirmar "sim, é o nosso" e distinguir o de
 * teste do de produção, sem que o certificado passe pelo navegador.
 */
export function impressaoDigital(certificadoBase64: string): string {
  const hex = createHash("sha256").update(Buffer.from(certificadoBase64, "base64")).digest("hex").toUpperCase();
  return (hex.match(/.{2}/g) ?? []).join(":");
}
