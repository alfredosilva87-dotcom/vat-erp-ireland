/**
 * Zera os DOCUMENTOS do banco local e recria um conjunto de teste.
 *
 * Apaga movimento (notas de entrada, vendas, fila da caixa de entrada,
 * obrigações) e MANTÉM cadastro (clientes, filiais, plano de contas, regras de
 * fornecedor, contas e extratos de banco): recriar cadastro a cada rodada de
 * teste custa tempo e não é o que se está testando.
 *
 * Só roda contra localhost — a checagem embaixo recusa qualquer outra coisa.
 *
 * Uso: node scripts/reset-test-data.js
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

function loadEnvLocal() {
  const p = path.join(__dirname, "..", ".env.local");
  const env = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

// ---------- PDF sintético de uma página ----------
function makePdf(lines) {
  const text = lines
    .map((l, i) => `1 0 0 1 40 ${760 - i * 18} Tm (${String(l).replace(/[()\\]/g, "\\$&")}) Tj`)
    .join(" ");
  const stream = `BT /F1 10 Tf ${text} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xrefStart = body.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { xref += `${String(off).padStart(10, "0")} 00000 n \n`; });
  body += xref + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

const tag = crypto.randomBytes(3).toString("hex").toUpperCase();
const m2 = (n) => n.toFixed(2);
/** Documento com linha de item explícita bate o placar da validação e evita a
 *  escalada para visão — metade das chamadas de IA por documento. */
const doc = (supplier, number, date, net, rate, itemText) => {
  const vat = +(net * rate / 100).toFixed(2);
  return [
    supplier, `Invoice ${number}`, `Date: ${date}`, "",
    "Items:",
    `1 x ${itemText}   Net ${m2(net)}   VAT ${rate}% ${m2(vat)}`, "",
    `Net: ${m2(net)}  VAT: ${m2(vat)}  Gross: ${m2(net + vat)}`,
  ];
};

async function main() {
  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Faltam variáveis em .env.local"); process.exit(1); }
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error(`RECUSADO: ${url} não é local. Este script só mexe no banco de teste.`);
    process.exit(1);
  }
  const sb = createClient(url, key);

  const { data: client } = await sb.from("clients").select("id,name,client_code").eq("client_code", "C0001").maybeSingle();
  if (!client) { console.error("Cliente C0001 não encontrado."); process.exit(1); }

  // ---------- limpeza ----------
  console.log("Limpando documentos e movimentos…");
  // Ordem: filhos antes dos pais, para o caso de alguma FK não ter cascade.
  for (const t of ["invoice_items", "sales_items", "invoice_documents", "invoice_audit"]) {
    const { error } = await sb.from(t).delete().not("id", "is", null);
    if (error && !/does not exist/i.test(error.message)) console.log(`  (${t}: ${error.message})`);
  }
  for (const t of ["invoices", "sales", "inbox_items", "obligations", "recurring_obligations"]) {
    const { error } = await sb.from(t).delete().not("id", "is", null);
    if (error) console.log(`  (${t}: ${error.message})`);
    else console.log(`  ${t} zerada`);
  }
  // Arquivos órfãos no storage: a linha se foi, o arquivo tem de ir junto.
  for (const prefix of ["inbox", "sales", ""]) {
    const { data: files } = await sb.storage.from("documents").list(prefix, { limit: 1000 });
    const paths = (files || []).filter((f) => f.name && f.id).map((f) => (prefix ? `${prefix}/${f.name}` : f.name));
    if (paths.length) await sb.storage.from("documents").remove(paths);
  }
  console.log("  storage limpo");

  // ---------- dados de teste ----------
  console.log(`\nCriando dados de teste para ${client.client_code} · ${client.name}…`);

  const ITEMS = [
    // ---- ENTRADAS (compras) ----
    { dir: "purchase", src: "email", sender: "ap@officesupplies.ie", subject: `Invoice OS-${tag}`,
      body: "Fatura de material de escritório.", file: `compra-office-${tag}.pdf`,
      lines: doc("Office Supplies Ltd", `OS-${tag}`, "2026-07-08", 180, 23, "Papel A4 e toner") },
    { dir: "purchase", src: "email", sender: "faturas@postocentral.ie", subject: `Fatura PC-${tag}`,
      body: "Abastecimento da frota.", file: `compra-combustivel-${tag}.pdf`,
      lines: doc("Posto Central Ltd", `PC-${tag}`, "2026-07-15", 95.4, 23, "Diesel 60L") },
    { dir: "purchase", src: "phone", sender: "Joao (motorista)", subject: null,
      body: "Enviado do telefone por Joao (motorista): Diesel na M50", file: `foto-posto-${tag}.pdf`,
      lines: doc("Posto M50 Ltd", `M50-${tag}`, "2026-08-03", 72, 23, "Diesel 45L") },
    { dir: "purchase", src: "email", sender: "contas@cafecentral.ie", subject: `Fatura CC-${tag}`,
      body: "Consumo do mês.", file: `compra-cafe-${tag}.pdf`,
      lines: doc("Cafe Central Ltd", `CC-${tag}`, "2026-08-11", 48.5, 13.5, "Refeicoes equipa") },
    // ---- SAÍDAS (vendas) ----
    { dir: "sale", src: "email", sender: "faturamento@cliente.ie", subject: `Nota de venda SV-${tag}`,
      body: "Nota emitida ao cliente.", file: `venda-${tag}.pdf`,
      lines: doc("Comprador Alfa Ltd", `SV-${tag}`, "2026-07-22", 1250, 23, "Servico prestado") },
    { dir: "sale", src: "phone", sender: "Maria (loja)", subject: null,
      body: "Enviado do telefone por Maria (loja): venda do balcao", file: `venda-balcao-${tag}.pdf`,
      lines: doc("Comprador Beta Ltd", `SV2-${tag}`, "2026-08-09", 340, 23, "Venda de balcao") },
    // ---- PLANILHA DE VENDAS (para a leitura por foto) ----
    { dir: "sale", src: "phone", sender: "Maria (loja)", subject: null,
      body: "Enviado do telefone por Maria (loja): planilha de vendas do mes",
      file: `planilha-vendas-${tag}.pdf`,
      lines: [
        "A1 Test Ltd - Vendas do mes (Agosto 2026)", "",
        "Data        Doc      Cliente              Liquido   IVA%   IVA",
        "05/08/2026  SV-101   Padaria do Joao       420.00    23    96.60",
        "09/08/2026  SV-102   Mercado Silva         180.00    23    41.40",
        "14/08/2026  SV-103   Cafe Central          260.00    23    59.80",
        "21/08/2026  SV-104   Restaurante Mar        95.00    9      8.55",
        "28/08/2026  SV-105   Loja Norte            510.00    23   117.30",
        "", "TOTAL                                 1465.00         323.65",
      ] },
    // ---- SUJEIRA: nao e documento fiscal (testa o classificador) ----
    { dir: "purchase", src: "phone", sender: "Joao (motorista)", subject: null,
      body: "Enviado do telefone por Joao (motorista): mandei sem querer",
      file: `foto-errada-${tag}.pdf`,
      lines: [
        "LISTA DE COMPRAS DE CASA", "",
        "leite", "pao", "cafe", "sabao em po", "", "ligar para o dentista",
      ] },
    // ---- item sem anexo (testa o card "nao entrou") ----
    { dir: "purchase", src: "email", sender: "ap@fornecedor.ie", subject: `Sem anexo (${tag})`,
      body: "Esqueci de anexar, mando depois.", file: null, lines: null },
  ];

  for (const it of ITEMS) {
    const id = crypto.randomUUID();
    let document_path = null, mime_type = null, size_bytes = null, content_hash = null;
    let status = "pending", refused_reason = null;

    if (it.file) {
      const bytes = makePdf(it.lines);
      document_path = `inbox/${id}.pdf`;
      const { error } = await sb.storage.from("documents")
        .upload(document_path, bytes, { contentType: "application/pdf", upsert: true });
      if (error) { console.error(`  ! ${it.file}: ${error.message}`); continue; }
      mime_type = "application/pdf"; size_bytes = bytes.length;
      content_hash = crypto.createHash("sha256").update(bytes).digest("hex");
    } else {
      status = "refused"; refused_reason = "Mensagem sem anexo.";
    }

    const { error } = await sb.from("inbox_items").insert({
      id, client_id: client.id, direction: it.dir, source: it.src,
      sender: it.sender, subject: it.subject, body: it.body,
      received_at: new Date().toISOString(),
      filename: it.file, mime_type, size_bytes, document_path, content_hash,
      status, refused_reason,
    });
    if (error) { console.error(`  ! ${it.subject || it.file}: ${error.message}`); continue; }
    console.log(`  + [${it.dir}/${it.src}] ${it.subject || it.file}`);
  }

  console.log("\nPronto. Tudo entra pela Caixa de entrada do cliente (módulo Compras).");
  console.log("A planilha de vendas também dá para testar em Vendas > Foto de planilha (IA).");
}

main();
