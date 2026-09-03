/**
 * A ASSINATURA QUE A REVENUE EXIGE — teste.
 *
 * Este teste existe porque o modo de falhar é cruel: um espaço a mais na
 * "signing string" dá `401`, e um `401` não diz qual foi o espaço. Não há como
 * depurar isso contra o servidor deles — tem de estar certo à primeira.
 *
 * Duas âncoras:
 *
 * 1. O exemplo PUBLICADO no guia (secção 4.1.3), carácter a carácter. Se a
 *    construção mudar, isto parte.
 * 2. Um ciclo completo assinar → verificar, com um par RSA gerado na hora. Não
 *    precisa do certificado do escritório, e prova que o que sai é uma
 *    assinatura RSA-SHA512 válida sobre exactamente a string construída.
 */
const crypto = require("crypto");
const {
  signingString, cabecalhosAssinados, digest, montarCabecalhos,
  agoraParaRevenue, dentroDaJanela, JANELA_MS,
} = require("../.test-build/revenue/assinatura");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const sha512b64 = (s) => crypto.createHash("sha512").update(s, "utf8").digest("base64");

console.log("\n== O EXEMPLO DO GUIA, carácter a carácter ==");
{
  // Guia, seccao 4.1.3, ultimo bloco.
  const esperado =
    "(request-target): get /paye-employers/v1/rest/rpn/{employerReg}/{taxYear}?softwareUsed=XYZ&softwareVersion=1.0\n" +
    "host: softwaretestnextversion.ros.ie\n" +
    "date: yyyy-MM-ddTHH:mm:ss.SSSX";

  const obtido = signingString({
    metodo: "GET",
    caminho: "/paye-employers/v1/rest/rpn/{employerReg}/{taxYear}?softwareUsed=XYZ&softwareVersion=1.0",
    host: "softwaretestnextversion.ros.ie",
    data: "yyyy-MM-ddTHH:mm:ss.SSSX",
  });
  ok(obtido === esperado, "a signing string do GET bate com o exemplo publicado",
    { obtido, esperado });
  ok(!obtido.endsWith("\n"), "NAO ha newline no fim — um newline final muda o que se assina");
  ok(obtido.split("\n").length === 3, "tres linhas, nem mais nem menos");
}

console.log("\n== o metodo vai em minusculas, e a query VAI junto ==");
{
  const s = signingString({
    metodo: "POST", caminho: "/x?a=1&b=2", host: "h", data: "d", corpo: "{}",
  }, sha512b64);
  ok(s.startsWith("(request-target): post /x?a=1&b=2"),
    "POST em minusculas e com a query dentro", s.split("\n")[0]);
}

console.log("\n== o digest so existe quando ha corpo ==");
{
  ok(cabecalhosAssinados(false).join(" ") === "(request-target) host date",
    "GET nao declara digest — declarar um que nao existe e caminho para 401");
  ok(cabecalhosAssinados(true).join(" ") === "(request-target) host date digest",
    "POST declara digest, e no fim da lista");
  ok(signingString({ metodo: "GET", caminho: "/x", host: "h", data: "d" }).includes("digest") === false,
    "e a string do GET nao tem linha de digest");
}

console.log("\n== o Digest e SHA-512 do corpo, em base64 ==");
{
  const corpo = '{"employerRegistrationNumber":"1234567T"}';
  const d = digest(corpo, sha512b64);
  ok(d.startsWith("SHA-512="), "leva o prefixo do RFC 3230", d.slice(0, 12));
  ok(d.slice(8) === crypto.createHash("sha512").update(corpo, "utf8").digest("base64"),
    "e o valor e mesmo o SHA-512 do corpo");
  ok(digest("", sha512b64) !== digest(" ", sha512b64), "corpo vazio e um espaco nao dao o mesmo");
}

console.log("\n== CICLO COMPLETO: assinar e verificar, com par gerado na hora ==");
{
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const assinar = (s) => crypto.sign("sha512", Buffer.from(s, "utf8"), privateKey).toString("base64");

  const p = {
    metodo: "GET",
    caminho: "/paye-employers/v1/rest/rpn/1234567T/2026?softwareUsed=ACCENTRA&softwareVersion=1.0",
    host: "softwaretestnextversion.ros.ie",
    data: "2026-09-03T22:00:00.000Z",
  };
  const h = montarCabecalhos(p, "CERT_EM_BASE64", assinar, sha512b64);

  ok(h.Signature.includes('algorithm="rsa-sha512"'), "declara rsa-sha512");
  ok(h.Signature.includes('keyId="CERT_EM_BASE64"'), "o keyId leva o CERTIFICADO, nao a chave");
  ok(h.Signature.includes('headers="(request-target) host date"'), "a lista de cabecalhos, por ordem");
  ok(h.Digest === undefined && h["Content-Type"] === undefined, "GET nao leva Digest nem Content-Type");

  const assinatura = h.Signature.match(/signature="([^"]+)"/)[1];
  const confere = crypto.verify(
    "sha512", Buffer.from(signingString(p), "utf8"), publicKey, Buffer.from(assinatura, "base64")
  );
  ok(confere, "A ASSINATURA VERIFICA contra a string construida — o ciclo fecha");

  // E a prova de que morde: mexer num caracter derruba a verificacao.
  const adulterada = signingString({ ...p, host: "outro.ros.ie" });
  ok(!crypto.verify("sha512", Buffer.from(adulterada, "utf8"), publicKey, Buffer.from(assinatura, "base64")),
    "trocar o host derruba a verificacao — e por isso que um espaco a mais da 401");
}

console.log("\n== POST: leva Digest e Content-Type ==");
{
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const assinar = (s) => crypto.sign("sha512", Buffer.from(s, "utf8"), privateKey).toString("base64");
  const corpo = '{"a":1}';
  const h = montarCabecalhos(
    { metodo: "POST", caminho: "/x", host: "h", data: "2026-01-01T00:00:00.000Z", corpo },
    "CERT", assinar, sha512b64
  );
  ok(h.Digest === digest(corpo, sha512b64), "o Digest do cabecalho e o mesmo que entrou na assinatura");
  ok(h["Content-Type"] === "application/json", "e o Content-Type que o guia exige no POST");
  ok(h.Signature.includes('headers="(request-target) host date digest"'), "com digest declarado");
}

console.log("\n== POST sem digestor e erro, e nao uma assinatura silenciosamente errada ==");
{
  let rebentou = false;
  try { signingString({ metodo: "POST", caminho: "/x", host: "h", data: "d", corpo: "{}" }); }
  catch (e) { rebentou = true; }
  ok(rebentou, "falta o digestor: rebenta aqui, em vez de dar 401 no servidor deles");
}

console.log("\n== a data: ISO 8601, UTC, dois digitos ==");
{
  const d = agoraParaRevenue(new Date(Date.UTC(2018, 0, 1, 12, 0, 0)));
  ok(d === "2018-01-01T12:00:00.000Z", "1 de Janeiro sai 01-01, e nao 1-1", d);
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(agoraParaRevenue()), "e o formato e sempre este");
}

console.log("\n== a janela de 90 minutos, para os dois lados ==");
{
  const agora = new Date("2026-09-03T12:00:00.000Z");
  ok(JANELA_MS === 5400000, "90 minutos em ms", JANELA_MS);
  ok(dentroDaJanela("2026-09-03T12:00:00.000Z", agora), "o proprio instante");
  ok(dentroDaJanela("2026-09-03T10:31:00.000Z", agora), "89 minutos ATRAS ainda vale");
  ok(dentroDaJanela("2026-09-03T13:29:00.000Z", agora), "89 minutos A FRENTE tambem — relogios dessincronizados");
  ok(!dentroDaJanela("2026-09-03T10:29:00.000Z", agora), "91 minutos atras ja nao");
  ok(!dentroDaJanela("nao e data", agora), "lixo nao passa por data valida");
}

console.log(`\n${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
