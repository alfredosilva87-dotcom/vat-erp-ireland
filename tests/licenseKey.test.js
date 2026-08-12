/**
 * Chave de licenca assinada — testes.
 *
 * Roda com `npm test`, que compila lib/licenseKey.ts antes.
 *
 * O que estes testes protegem: a chave e o que autoriza o uso do produto. Um
 * defeito aqui e de dois tipos, e os dois sao caros — recusar licenca legitima
 * (cliente pagante travado) ou aceitar licenca forjada (produto de graca).
 */
const { generateKeyPairSync } = require("crypto");
const L = require("../.test-build/licenseKey.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

// Par de chaves proprio do teste: nao depende do par real da maquina de quem
// vende, e por isso este teste roda em qualquer clone do repositorio.
const kp = generateKeyPairSync("ed25519");
const PRIV = kp.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUB = kp.publicKey.export({ type: "spki", format: "pem" }).toString();
process.env.LICENSE_PUBLIC_KEY = PUB;

// Um segundo par, para o papel de "quem tenta forjar".
const evil = generateKeyPairSync("ed25519");
const EVIL_PRIV = evil.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const payload = (over) => Object.assign(
  L.buildPayload({ slug: "precisetax", name: "Precise Tax", months: 12, id: "abcd1234", today: "2026-08-12" }),
  over
);

// ------------------------------------------------------------ CARGA
console.log("\n== a validade sai da contagem de meses ==");
let p = L.buildPayload({ slug: "x", months: 12, id: "1", today: "2026-08-12" });
ok(p.e === "2027-08-12", "12 meses de 2026-08-12", p.e);
p = L.buildPayload({ slug: "x", months: 1, id: "1", today: "2026-01-31" });
ok(p.e === "2026-03-03" || p.e === "2026-02-28" || p.e === "2026-03-02",
  "31 de janeiro + 1 mes cai num dia real de fevereiro/marco, nao em 31/02", p.e);
p = L.buildPayload({ slug: "PreciseTax", months: 6, id: "1", today: "2026-08-12" });
ok(p.c === "precisetax", "o slug e guardado minusculo, para o encaixe nao depender de caixa", p.c);

console.log("\n== a assinatura e sobre carga CANONICA, nao sobre a ordem das chaves ==");
const a = L.canonical({ v: 1, c: "x", n: "N", e: "2027-01-01", i: "2026-01-01", id: "1" });
const b = L.canonical({ id: "1", i: "2026-01-01", e: "2027-01-01", n: "N", c: "x", v: 1 });
ok(a.toString() === b.toString(), "duas ordens de escrita produzem a mesma carga assinada");

// ------------------------------------------------------------ EMITIR / CONFERIR
console.log("\n== emitir e conferir ==");
const key = L.issueLicenseKey(payload(), PRIV);
ok(key.startsWith("VATERP1."), "prefixo reconhecivel");
ok(key.split(".").length === 3, "tres partes separadas por ponto");
let v = L.verifyLicenseKey(key);
ok(v.ok, "chave recem emitida confere", v.error);
ok(v.ok && v.payload.c === "precisetax" && v.payload.e === "2027-08-12",
  "a carga volta inteira", v.ok && v.payload);

console.log("\n== espaco e quebra de linha no meio nao invalidam ==");
const quebrada = key.slice(0, 40) + "\n  " + key.slice(40);
ok(L.verifyLicenseKey(quebrada).ok, "colar de um e-mail que quebrou a linha continua funcionando");

// ------------------------------------------------------------ FORJA
console.log("\n== forjar nao funciona ==");
v = L.verifyLicenseKey(L.issueLicenseKey(payload(), EVIL_PRIV));
ok(!v.ok && /assinatura/i.test(v.error), "assinada com OUTRA chave privada e recusada", v.error);

console.log("\n== alterar a data depois de assinada nao funciona ==");
const parts = key.split(".");
const alterada = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
alterada.e = "2099-12-31";
const cargaFalsa = Buffer.from(JSON.stringify(alterada)).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
v = L.verifyLicenseKey(`VATERP1.${cargaFalsa}.${parts[2]}`);
ok(!v.ok && /assinatura/i.test(v.error), "esticar a validade quebra a assinatura", v.error);

console.log("\n== texto que nao e chave ==");
ok(!L.verifyLicenseKey("").ok, "vazio");
ok(!L.verifyLicenseKey("VAT-ABCDE-12345-XYZWQ").ok, "o formato ANTIGO nao passa pelo caminho assinado");
v = L.verifyLicenseKey("VATERP1.lixo.lixo");
ok(!v.ok, "partes que nao decodificam", v.error);
v = L.verifyLicenseKey("qualquer coisa colada errado");
ok(!v.ok && /nao parece|não parece/i.test(v.error), "diz que nao parece uma chave, em vez de 'invalida'", v.error);

console.log("\n== sem chave publica embutida, nada e aceito ==");
const saved = process.env.LICENSE_PUBLIC_KEY;
delete process.env.LICENSE_PUBLIC_KEY;
// O modulo compilado tem o PLACEHOLDER trocado pela publica real da maquina; num
// clone sem keygen rodado ele continua PLACEHOLDER. Os dois casos sao aceitaveis
// aqui: o que nao pode e aceitar a chave do par de TESTE sem a variavel.
v = L.verifyLicenseKey(key);
ok(!v.ok, "chave do par de teste nao passa com a publica de producao", v.error);
process.env.LICENSE_PUBLIC_KEY = saved;

// ------------------------------------------------------------ ENCAIXE
console.log("\n== a chave e desta instalacao? ==");
let f = L.checkFit(payload(), "precisetax", null, "2026-08-12");
ok(f.ok, "mesma empresa, dentro da validade", f.error);

f = L.checkFit(payload(), "outroescritorio", null, "2026-08-12");
ok(!f.ok && /emitida para/.test(f.error),
  "chave de outra empresa e recusada dizendo de quem ela e", f.error);

f = L.checkFit(payload(), "PRECISETAX", null, "2026-08-12");
ok(f.ok, "a comparacao de slug ignora caixa");

console.log("\n== chave vencida ==");
f = L.checkFit(payload({ e: "2026-08-11" }), "precisetax", null, "2026-08-12");
ok(!f.ok && /venceu/.test(f.error), "vencida ontem nao ativa", f.error);

console.log("\n== chave antiga reencontrada no e-mail nao encurta a licenca ==");
f = L.checkFit(payload({ e: "2027-01-01" }), "precisetax", "2027-08-12", "2026-08-12");
ok(!f.ok && /mais que esta chave/.test(f.error),
  "aplicar chave mais curta que a atual e recusado, e nada e alterado", f.error);

console.log("\n== reaplicar a MESMA chave e inofensivo ==");
f = L.checkFit(payload(), "precisetax", "2027-08-12", "2026-08-12");
ok(f.ok, "mesma validade da atual passa, para o clique repetido nao virar erro", f.error);

console.log("\n== renovar para mais longe passa ==");
f = L.checkFit(payload({ e: "2028-08-12" }), "precisetax", "2027-08-12", "2026-08-12");
ok(f.ok, "renovacao que estende a validade", f.error);

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========`);
process.exit(fail ? 1 : 0);
