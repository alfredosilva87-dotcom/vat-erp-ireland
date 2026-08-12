#!/usr/bin/env node
/**
 * Lista as licenças já emitidas e devolve a chave para copiar de novo.
 * RODA NA MÁQUINA DE QUEM VENDE.
 *
 *   node selfhost/scripts/license-list.js                  # tudo
 *   node selfhost/scripts/license-list.js --slug precisetax
 *   node selfhost/scripts/license-list.js --id 3f28fa38    # só a chave, crua
 *   node selfhost/scripts/license-list.js --id 3f28fa38 | pbcopy
 *
 * Cada chave é conferida contra a chave pública embutida no programa, então uma
 * linha adulterada ou truncada no registro aparece como INVÁLIDA em vez de ser
 * mandada ao cliente e falhar na tela dele.
 */
const registry = require("./license-registry");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

const wantSlug = arg("slug");
const wantId = arg("id");

const { entries, unreadable } = registry.read();

if (!entries.length) {
  console.error(`Nenhuma licença registrada em ${registry.LEDGER}.`);
  console.error("O registro começa na primeira emissão feita com o license-issue.js;");
  console.error("licenças emitidas antes dele existir não estão aqui.");
  process.exit(1);
}

// --id imprime só a chave, sem enfeite, para poder mandar direto para o pbcopy.
if (wantId) {
  const hit = entries.filter((e) => e.id === wantId).pop();
  if (!hit) {
    console.error(`Não achei emissão com id ${wantId}. Rode sem --id para ver a lista.`);
    process.exit(1);
  }
  console.log(hit.key);
  process.exit(0);
}

const { verifyLicenseKey } = registry.loadLicenseLib();

const today = new Date().toISOString().slice(0, 10);
const shown = wantSlug ? entries.filter((e) => e.slug === wantSlug) : entries;

if (!shown.length) {
  console.error(`Nenhuma licença emitida para "${wantSlug}".`);
  process.exit(1);
}

// A licença que vale para uma empresa é a de vencimento mais longe, não a mais
// recente: reemitir com menos meses não encurta o que o cliente já tem.
const currentBySlug = new Map();
for (const e of entries) {
  const best = currentBySlug.get(e.slug);
  if (!best || e.expires > best.expires) currentBySlug.set(e.slug, e);
}

console.log("");
console.log(`=== Licenças emitidas (${registry.LEDGER}) ===`);
console.log("");

for (const e of shown.slice().reverse()) {
  const verified = verifyLicenseKey(e.key);
  const marks = [];
  if (!verified.ok) marks.push(`INVÁLIDA (${verified.error})`);
  if (currentBySlug.get(e.slug)?.id === e.id) {
    marks.push(e.expires < today ? "vigente, VENCIDA" : "vigente");
  } else {
    marks.push("substituída");
  }
  console.log(`  ${e.id}  ${e.slug}${e.name ? ` — ${e.name}` : ""}`);
  const dur = `${e.months} ${e.months === 1 ? "mês" : "meses"}`;
  console.log(`            emitida ${e.issued} · vence ${e.expires} (${dur}) · ${marks.join(" · ")}`);
}

console.log("");
console.log("Para copiar uma chave:  node selfhost/scripts/license-list.js --id <id>");
if (unreadable) {
  console.log("");
  console.log(`Atenção: ${unreadable} linha(s) do registro não são JSON válido e foram ignoradas.`);
}
