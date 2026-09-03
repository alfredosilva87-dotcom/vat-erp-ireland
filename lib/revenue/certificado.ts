/**
 * ABRIR O `.p12` DO ROS — uma vez, na importação, e nunca mais.
 *
 * O Apêndice A do guia de integração diz o essencial: "Each customer of ROS
 * will have a digital certificate and private key stored in an industry
 * standard PKCS#12 file. In order to create a digital signature, the private
 * key of the customer must be accessed."
 *
 * ---------------------------------------------------------------------------
 * PORQUE `node-forge` E NÃO `openssl`
 *
 * O `node:crypto` não lê PKCS#12. Ficavam duas hipóteses: chamar o `openssl`
 * da máquina, ou uma biblioteca em JavaScript. O `openssl` não existe de forma
 * garantida no runtime onde isto corre, e uma dependência que só funciona em
 * metade dos sítios é pior do que uma dependência a mais.
 *
 * ---------------------------------------------------------------------------
 * O QUE SAI DAQUI, E O QUE NÃO SAI
 *
 * Sai o certificado (para o `keyId`) e a chave privada em PEM (para assinar).
 * Sai também o que o certificado diz de si — a quem pertence e até quando vale
 * — para o ecrã poder mostrar isso sem nunca mostrar o certificado.
 *
 * NÃO sai a senha: ela entra, abre o ficheiro, e acaba ali. Ver ./cofre.ts.
 */

import forge from "node-forge";

export interface CertificadoAberto {
  /** X509 em base64, sem cabeçalhos PEM — é o que o campo `keyId` espera. */
  certificadoBase64: string;
  /** A chave privada em PEM. Vai cifrada para a base de dados. */
  chavePrivadaPem: string;
  /** A quem pertence, como o certificado o declara. */
  titular: string;
  /** Quem o emitiu. */
  emissor: string;
  /** Validade, em ISO. O ecrã avisa antes de expirar. */
  validoDe: string;
  validoAte: string;
}

/**
 * Abre o ficheiro. Erra com uma frase que se percebe.
 *
 * A senha errada é, de longe, o engano mais comum — e a mensagem crua da
 * biblioteca ("Invalid password?") não distingue isso de um ficheiro corrompido
 * ou de um ficheiro que nem é um `.p12`. Aqui distingue-se, porque as três
 * pedem gestos diferentes.
 */
export function abrirP12(bytes: Buffer, senha: string): CertificadoAberto {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(bytes.toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/password|mac could not be verified|invalid/i.test(msg)) {
      throw new Error("A senha do certificado não está certa. É a senha que o ROS pediu ao descarregar o ficheiro .p12.");
    }
    throw new Error("Este ficheiro não parece ser um certificado .p12 do ROS. Confirme que é o ficheiro descarregado do ROS e que não foi alterado.");
  }

  // A chave privada e o certificado vêm em sacos separados dentro do ficheiro.
  const sacosDeChave = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]
    ?? p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]
    ?? [];
  const sacosDeCert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];

  const chave = sacosDeChave.find((b) => b.key)?.key;
  if (!chave) throw new Error("O ficheiro abriu, mas não traz chave privada lá dentro. Sem a chave não é possível assinar, e o ROS recusa o pedido.");

  /*
   * Quando há mais de um certificado (cadeia), o do TITULAR é o que casa com a
   * chave privada. Escolher o primeiro da lista às cegas é como se põe lá
   * dentro, por engano, o certificado da autoridade emissora — e aí a Revenue
   * devolve 401 sem dizer que o `keyId` está trocado.
   */
  const publicaDaChave = forge.pki.setRsaPublicKey((chave as any).n, (chave as any).e);
  const pemDaPublicaDaChave = forge.pki.publicKeyToPem(publicaDaChave);
  const cert =
    sacosDeCert.map((b) => b.cert).find(
      (c) => c && forge.pki.publicKeyToPem(c.publicKey as any) === pemDaPublicaDaChave
    ) ?? sacosDeCert.find((b) => b.cert)?.cert;

  if (!cert) throw new Error("O ficheiro abriu, mas não traz certificado lá dentro.");

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const nome = (campos: forge.pki.CertificateField[]) =>
    campos.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(", ");

  return {
    certificadoBase64: forge.util.encode64(der),
    chavePrivadaPem: forge.pki.privateKeyToPem(chave),
    titular: nome(cert.subject.attributes),
    emissor: nome(cert.issuer.attributes),
    validoDe: cert.validity.notBefore.toISOString(),
    validoAte: cert.validity.notAfter.toISOString(),
  };
}

/**
 * Quantos dias faltam até o certificado deixar de valer.
 *
 * O certificado do ROS expira, e quando expira a folha PARA — sem aviso
 * nenhum, num `401` igual ao de uma assinatura errada. Ter isto à mão permite
 * avisar semanas antes, que é a diferença entre uma renovação e uma crise na
 * semana do pagamento.
 */
export function diasAteExpirar(validoAte: string, agora: Date = new Date()): number {
  const t = Date.parse(validoAte);
  if (Number.isNaN(t)) return 0;
  return Math.floor((t - agora.getTime()) / 86400000);
}
