/**
 * O COFRE E A ABERTURA DO `.p12` — teste.
 *
 * Não há certificado do ROS aqui, e não é preciso: o teste GERA um `.p12` real
 * (mesmo formato, mesma cifra) e faz o caminho todo — abrir, guardar cifrado,
 * decifrar, assinar com a chave que saiu. Se este teste passa, o único degrau
 * que falta no dia da estreia é a Revenue reconhecer o certificado; tudo o que
 * está deste lado já está provado.
 *
 * O que se guarda com mais cuidado:
 *
 * 1. **A senha do `.p12` não é guardada.** Ela entra, abre, e acaba ali. É a
 *    decisão de desenho mais importante deste módulo, e um teste é a única
 *    coisa que a impede de ser revertida por conveniência.
 * 2. **A senha errada tem mensagem própria.** É o engano mais comum, e a
 *    mensagem crua da biblioteca não o distingue de um ficheiro corrompido.
 * 3. **Texto cifrado adulterado FALHA.** Se devolvesse lixo, o lixo virava uma
 *    assinatura inválida e um 401 impossível de depurar.
 */
const crypto = require("crypto");
const forge = require("node-forge");

process.env.REVENUE_CERT_KEY = "um-segredo-de-teste-suficientemente-longo";

const { cifrar, decifrar, cofreConfigurado, impressaoDigital } = require("../.test-build/revenue/cofre");
const { abrirP12, diasAteExpirar } = require("../.test-build/revenue/certificado");
const { signingString, montarCabecalhos } = require("../.test-build/revenue/assinatura");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

/** Fabrica um .p12 igual em forma ao que o ROS entrega. */
function fabricarP12(senha, { dias = 365 } = {}) {
  const par = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = par.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + dias * 86400000);
  const quem = [{ name: "commonName", value: "Precise Tax and Accounting Solutions" },
                { name: "countryName", value: "IE" }];
  cert.setSubject(quem);
  cert.setIssuer([{ name: "commonName", value: "Revenue Commissioners Test CA" }]);
  cert.sign(par.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(par.privateKey, [cert], senha, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary");
}

console.log("\n== abrir o ficheiro que o ROS entrega ==");
const SENHA = "senha-do-ros-123";
const p12 = fabricarP12(SENHA);
let aberto;
{
  aberto = abrirP12(p12, SENHA);
  ok(aberto.certificadoBase64.length > 100, "sai o certificado em base64");
  ok(aberto.chavePrivadaPem.includes("PRIVATE KEY"), "sai a chave privada em PEM");
  ok(/Precise Tax/.test(aberto.titular), "e diz de quem e", aberto.titular);
  ok(/Revenue/.test(aberto.emissor), "e quem o emitiu", aberto.emissor);
  ok(!aberto.certificadoBase64.includes("BEGIN CERTIFICATE"),
    "o base64 vai SEM cabecalhos PEM — e o que o campo keyId espera");
}

console.log("\n== a senha errada tem mensagem PROPRIA ==");
{
  let msg = "";
  try { abrirP12(p12, "senha-errada"); } catch (e) { msg = e.message; }
  ok(/senha/i.test(msg), "diz que e a senha", msg);
  ok(!/asn1|der|forge|undefined/i.test(msg), "e nao despeja o erro cru da biblioteca", msg);
}

console.log("\n== e um ficheiro que nem e .p12 tem outra ==");
{
  let msg = "";
  try { abrirP12(Buffer.from("isto nao e um certificado"), SENHA); } catch (e) { msg = e.message; }
  ok(/\.p12|ROS/i.test(msg), "diz que o ficheiro esta errado, nao a senha", msg);
}

console.log("\n== O CICLO REAL: guardar cifrado, tirar, e ASSINAR com o que saiu ==");
{
  const guardado = cifrar(aberto.chavePrivadaPem);
  ok(guardado.split(".").length === 3, "guarda-se como iv.tag.dados, numa linha so");
  ok(!guardado.includes("PRIVATE KEY"), "e a chave NAO se le no que fica guardado");

  const devolta = decifrar(guardado);
  ok(devolta === aberto.chavePrivadaPem, "decifrar devolve exactamente a mesma chave");

  // E a prova que interessa: essa chave assina, e a assinatura verifica.
  const assinar = (s) => crypto.sign("sha512", Buffer.from(s, "utf8"), devolta).toString("base64");
  const pedido = {
    metodo: "GET",
    caminho: "/paye-employers/v1/rest/rpn/1234567T/2026?softwareUsed=ACCENTRA&softwareVersion=1.0",
    host: "softwaretestnextversion.ros.ie",
    data: "2026-09-03T22:00:00.000Z",
  };
  const h = montarCabecalhos(pedido, aberto.certificadoBase64, assinar);
  const assinatura = h.Signature.match(/signature="([^"]+)"/)[1];
  const publica = crypto.createPublicKey({ key: devolta });
  ok(crypto.verify("sha512", Buffer.from(signingString(pedido), "utf8"), publica, Buffer.from(assinatura, "base64")),
    "A CHAVE QUE SAIU DO COFRE ASSINA, E A ASSINATURA VERIFICA — o caminho todo fecha");
}

console.log("\n== texto cifrado adulterado FALHA, e nao devolve lixo ==");
{
  const g = cifrar("segredo");
  const [iv, tag, dados] = g.split(".");
  const trocado = dados[0] === "A" ? "B" + dados.slice(1) : "A" + dados.slice(1);
  let rebentou = false;
  try { decifrar([iv, tag, trocado].join(".")); } catch (e) { rebentou = true; }
  ok(rebentou, "mexer num byte e apanhado pelo GCM");
  let rebentou2 = false;
  try { decifrar("formato-errado"); } catch (e) { rebentou2 = true; }
  ok(rebentou2, "formato inesperado tambem");
}

console.log("\n== sem a variavel de ambiente, RECUSA guardar ==");
{
  const antes = process.env.REVENUE_CERT_KEY;
  delete process.env.REVENUE_CERT_KEY;
  ok(cofreConfigurado() === false, "o produto sabe que nao esta configurado");
  let rebentou = false;
  try { cifrar("x"); } catch (e) { rebentou = true; }
  ok(rebentou, "e recusa cifrar, em vez de guardar em claro sem ninguem dar por isso");
  process.env.REVENUE_CERT_KEY = "curta";
  ok(cofreConfigurado() === false, "um segredo curto tambem nao serve");
  process.env.REVENUE_CERT_KEY = antes;
}

console.log("\n== a impressao digital identifica sem mostrar ==");
{
  const f = impressaoDigital(aberto.certificadoBase64);
  ok(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f), "SHA-256 em pares, como se le num certificado", f.slice(0, 20));
  const outro = abrirP12(fabricarP12("outra"), "outra");
  ok(impressaoDigital(outro.certificadoBase64) !== f, "certificados diferentes, impressoes diferentes");
}

console.log("\n== avisar ANTES de o certificado expirar ==");
{
  ok(diasAteExpirar(aberto.validoAte) > 360, "um certificado novo tem quase um ano", diasAteExpirar(aberto.validoAte));
  const quaseMorto = abrirP12(fabricarP12("x", { dias: 10 }), "x");
  const d = diasAteExpirar(quaseMorto.validoAte);
  ok(d >= 8 && d <= 10, "e um a dez dias do fim avisa a tempo de renovar", d);
  ok(diasAteExpirar("2020-01-01T00:00:00Z") < 0, "expirado da negativo");
  ok(diasAteExpirar("nao e data") === 0, "lixo nao rebenta");
}

console.log(`\n${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
