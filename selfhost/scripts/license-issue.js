#!/usr/bin/env node
/**
 * Emite uma chave de licença. RODA NA MÁQUINA DE QUEM VENDE, nunca no cliente.
 *
 *   node selfhost/scripts/license-issue.js --slug precisetax --months 12 \
 *        --name "Precise Tax and Accounting Solutions"
 *
 * A saída é uma linha de texto para mandar por e-mail. O cliente cola em
 * Configurações → Licença e o próprio programa confere a assinatura — sem
 * ninguém precisar entrar na instalação dele.
 *
 * Cada emissão fica gravada em ~/.vat-erp-license/issued.jsonl; para reler ou
 * copiar de novo: node selfhost/scripts/license-list.js
 */
const { randomBytes } = require("crypto");
const fs = require("fs");
const registry = require("./license-registry");

const PRIV = registry.PRIV;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const slug = arg("slug");
const months = Number(arg("months", "12"));
const name = arg("name", "");

if (!slug) {
  console.error("Uso: node selfhost/scripts/license-issue.js --slug <empresa> [--months 12] [--name \"Nome\"]");
  process.exit(1);
}
if (!Number.isInteger(months) || months < 1 || months > 120) {
  console.error("--months precisa ser um inteiro entre 1 e 120.");
  process.exit(1);
}
if (!fs.existsSync(PRIV)) {
  console.error(`Não achei a chave privada em ${PRIV}.`);
  console.error("Rode primeiro: node selfhost/scripts/license-keygen.js");
  process.exit(1);
}

const { buildPayload, issueLicenseKey } = registry.loadLicenseLib();

const payload = buildPayload({
  slug, name: name || undefined, months, id: randomBytes(4).toString("hex"),
});
const key = issueLicenseKey(payload, fs.readFileSync(PRIV, "utf8"));

// Gravado antes de imprimir: se o terminal fechar ou o e-mail se perder, a
// chave continua recuperável pelo license-list.js.
registry.append({
  id: payload.id, slug: payload.c, name: name || "", months,
  issued: payload.i, expires: payload.e, key,
});

console.log("");
console.log("=== Licença emitida ===");
console.log("  empresa :", payload.c, name ? `(${name})` : "");
console.log("  emitida :", payload.i);
console.log("  válida até:", payload.e, `(${months} meses)`);
console.log("  id      :", payload.id);
console.log("");
console.log("Chave para mandar ao cliente:");
console.log("");
console.log(key);
console.log("");
console.log(`Ele cola em Configurações → Licença. ${key.length} caracteres.`);
console.log(`Gravada em ${registry.LEDGER} — para copiar de novo: node selfhost/scripts/license-list.js --id ${payload.id}`);
