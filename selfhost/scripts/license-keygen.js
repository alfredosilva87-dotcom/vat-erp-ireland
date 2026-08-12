#!/usr/bin/env node
/**
 * Gera o par de chaves de licença. RODA UMA VEZ, na máquina de quem vende.
 *
 * A privada NUNCA entra no repositório: ela é o que impede o cliente de emitir
 * licença para si mesmo. A pública é gravada dentro de lib/licenseKey.ts e vai
 * para o repositório, porque é pública.
 *
 *   node selfhost/scripts/license-keygen.js
 *
 * Se já existir par gerado, o script para em vez de sobrescrever: trocar a chave
 * privada invalida todas as licenças já emitidas.
 */
const { generateKeyPairSync } = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = path.join(os.homedir(), ".vat-erp-license");
const PRIV = path.join(HOME, "private.pem");
const PUB = path.join(HOME, "public.pem");
const LIB = path.join(__dirname, "..", "..", "lib", "licenseKey.ts");

if (fs.existsSync(PRIV)) {
  console.error(`Já existe uma chave privada em ${PRIV}.`);
  console.error("Trocá-la invalidaria todas as licenças já emitidas. Apague à mão se for isso mesmo que você quer.");
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();

fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
fs.writeFileSync(PRIV, privPem, { mode: 0o600 });
fs.writeFileSync(PUB, pubPem, { mode: 0o644 });

// Embute a pública no código.
const src = fs.readFileSync(LIB, "utf8");
const body = pubPem.trim();
const replaced = src.replace(
  /export const LICENSE_PUBLIC_KEY_PEM = `[\s\S]*?`;/,
  "export const LICENSE_PUBLIC_KEY_PEM = `" + body + "`;"
);
if (replaced === src) {
  console.error("Não encontrei LICENSE_PUBLIC_KEY_PEM em lib/licenseKey.ts. Nada foi alterado no código.");
  console.error("A chave pública está em:", PUB);
  process.exit(1);
}
fs.writeFileSync(LIB, replaced);

console.log("Par de chaves criado.");
console.log("  privada (GUARDE, nunca comite):", PRIV);
console.log("  pública (embutida no código): lib/licenseKey.ts");
console.log("");
console.log("Faça backup da privada. Perdê-la significa não conseguir emitir");
console.log("licença nova sem atualizar o programa em todos os clientes.");
