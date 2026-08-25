// Reabastece a Caixa de entrada com itens de teste (anexo real em PDF, sobe
// pro storage local) para o cliente A1 Test Ltd (C0001) — só mexe no stack
// local (localhost:8000), nunca em produção. Dado descartável, ver
// selfhost/schema/008_mail_ingestion.sql e a memória "dados de teste locais".
//
// Uso: node scripts/seed-inbox-items.js

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

// PDF minimalista de uma página, texto em Helvetica — válido o bastante para
// abrir no visualizador e para o extrator de IA tentar ler.
function makePdf(lines) {
  const text = lines.map((l, i) => `1 0 0 1 50 ${750 - i * 20} Tm (${l.replace(/[()\\]/g, "\\$&")}) Tj`).join(" ");
  const stream = `BT /F1 12 Tf ${text} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefStart = body.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { xref += `${String(off).padStart(10, "0")} 00000 n \n`; });
  body += xref;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

// Sufixo aleatório por rodada + valor levemente variado: sem isso, rodar o
// script de novo gera o MESMO documento (mesmo número de nota, mesmo valor) e
// o anti-duplicata do próprio sistema — corretamente — recusa como repetido.
// Isso é o app funcionando certo, mas atrapalha testar de novo.
const runTag = crypto.randomBytes(3).toString("hex").toUpperCase();
const jitter = () => (Math.random() * 40 - 20).toFixed(2);
const money2 = (n) => n.toFixed(2);

// Uma linha de item explícita, com valor batendo exatamente com o total —
// é o que lib/extractor/validate.ts precisa pra pontuar bem na leitura só de
// texto (pdf-native) e NÃO escalar pra visão (que dobra a chamada à IA e
// consome cota mais rápido). Sem isso, todo documento de teste virava duas
// chamadas em vez de uma.
function buildItems() {
  const net1 = 180 + Number(jitter()), vat1 = +(net1 * 0.23).toFixed(2);
  const net2 = 95 + Number(jitter()), vat2 = +(net2 * 0.23).toFixed(2);
  const net3 = 300 + Number(jitter()), vat3 = +(net3 * 0.23).toFixed(2);
  return [
    {
      direction: "purchase", filename: `fatura-office-supplies-${runTag}.pdf`, sender: "ap@officesupplies.ie",
      subject: `Invoice OS-${runTag}`, body: "Segue a fatura de material de escritório do mês.",
      lines: ["Office Supplies Ltd", `Invoice OS-${runTag}`, "Date: 2026-08-10", "Items:",
        `1 x Office supplies bundle   Net ${money2(net1)}   VAT 23% ${money2(vat1)}`,
        `Net: ${money2(net1)}  VAT: ${money2(vat1)}  Gross: ${money2(net1 + vat1)}`],
    },
    {
      direction: "purchase", filename: `fatura-combustivel-${runTag}.pdf`, sender: "faturas@postocentral.ie",
      subject: `Fatura combustível ${runTag}`, body: "Abastecimento da frota.",
      lines: ["Posto Central Ltd", `Invoice PC-${runTag}`, "Date: 2026-08-12", "Items:",
        `1 x Diesel 60L   Net ${money2(net2)}   VAT 23% ${money2(vat2)}`,
        `Net: ${money2(net2)}  VAT: ${money2(vat2)}  Gross: ${money2(net2 + vat2)}`],
    },
    {
      direction: "sale", filename: `nota-venda-${runTag}.pdf`, sender: "faturamento@cliente.ie",
      subject: `Nota emitida ${runTag}`, body: "Nota do mês.",
      lines: ["A1 Test Ltd", `Sales Invoice ${runTag}`, "Date: 2026-08-14", "Items:",
        `1 x Serviço prestado   Net ${money2(net3)}   VAT 23% ${money2(vat3)}`,
        `Net: ${money2(net3)}  VAT: ${money2(vat3)}  Gross: ${money2(net3 + vat3)}`],
    },
    {
      // Origem "phone": simula o que a busca da passagem na nuvem (camada B4)
      // grava — remetente é a PESSOA, não um endereço, e não há assunto.
      // Existe aqui porque a passagem não está configurada no ambiente local
      // (faltam RELAY_SUPABASE_*), e sem isto não dá pra ver o indicador de
      // origem funcionando na tela.
      direction: "purchase", filename: `foto-posto-${runTag}.pdf`, sender: "Joao (motorista)",
      subject: null, body: `Enviado do telefone por Joao (motorista): Diesel na M50`,
      source: "phone",
      lines: ["Posto M50 Ltd", `Receipt M50-${runTag}`, "Date: 2026-08-15", "Items:",
        `1 x Diesel 45L   Net 72.00   VAT 23% 16.56`,
        `Net: 72.00  VAT: 16.56  Gross: 88.56`],
    },
    {
      direction: "purchase", filename: null, sender: "ap@fornecedor.ie",
      subject: `Sem anexo desta vez (${runTag})`, body: "Esqueci de anexar, mando depois.",
      lines: null, // vira "refused" de propósito, pra testar o card sem documento
    },
  ];
}
const ITEMS = buildItems();

async function main() {
  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Faltam variáveis em .env.local"); process.exit(1); }
  if (!/localhost|127\.0\.0\.1/.test(url)) { console.error(`Recusado: ${url} não parece local.`); process.exit(1); }

  const sb = createClient(url, key);

  const { data: client, error: cErr } = await sb.from("clients").select("id,name,client_code").eq("client_code", "C0001").maybeSingle();
  if (cErr) { console.error(cErr.message); process.exit(1); }
  if (!client) { console.error("Cliente C0001 (A1 Test Ltd) não encontrado no banco local."); process.exit(1); }
  console.log(`Cliente: ${client.client_code} · ${client.name}`);

  for (const it of ITEMS) {
    const id = crypto.randomUUID();
    let document_path = null, mime_type = null, size_bytes = null, content_hash = null, status = "pending", refused_reason = null;

    if (it.filename) {
      const bytes = makePdf(it.lines);
      document_path = `inbox/${id}.pdf`;
      const { error: upErr } = await sb.storage.from("documents").upload(document_path, bytes, { contentType: "application/pdf", upsert: true });
      if (upErr) { console.error(`Falha ao subir ${it.filename}: ${upErr.message}`); continue; }
      mime_type = "application/pdf";
      size_bytes = bytes.length;
      content_hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16) + "-" + id;
    } else {
      status = "refused";
      refused_reason = "Mensagem sem anexo.";
    }

    const row = {
      id, client_id: client.id, direction: it.direction, source: it.source || "email",
      sender: it.sender, subject: it.subject, body: it.body,
      received_at: new Date().toISOString(), filename: it.filename, mime_type, size_bytes,
      document_path, content_hash, status, refused_reason,
    };
    const { error: insErr } = await sb.from("inbox_items").insert(row);
    if (insErr) { console.error(`Falha ao inserir "${it.subject}": ${insErr.message}`); continue; }
    // Item de telefone não tem assunto (a foto vem sem), então cai no nome do
    // arquivo — senão o log imprime "null" e parece que algo falhou.
    console.log(`+ [${row.source}] ${it.subject || it.filename} (${status})`);
  }

  console.log("Pronto.");
}

main();
