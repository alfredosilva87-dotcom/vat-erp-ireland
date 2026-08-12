/**
 * Entrada por telefone (camada B4) — testes.
 *
 * Roda com `npm test`, que compila lib/phoneIntake.ts antes.
 *
 * Os comportamentos que mais custam se estiverem errados:
 *   1. O PEDIDO ADULTERADO mudando a direcao. Quem tem o link tem a URL, e a URL
 *      chega por WhatsApp. Se o campo "direction" do pedido decidisse, daria para
 *      jogar um custo na aba de vendas e mexer no VAT a pagar.
 *   2. O NOME DO ARQUIVO vindo do telefone. Camera de iPhone chama tudo de
 *      image.jpg, e nome de fora e caminho para atravessar diretorio.
 *   3. O TETO DE ENVIOS. Sem ele, link vazado e um jeito de entupir o
 *      armazenamento do escritorio, e o token nao tem senha para revogar rapido.
 */
const P = require("../.test-build/phoneIntake.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const link = (over) => Object.assign({
  token: "a7k2f9m3x1q8", client_id: "cliente-A", person: "Joao (motorista)",
  active: true, expires_at: null, allow_sale: false,
}, over);

// --------------------------------------------------------------- DIRECAO
console.log("\n== o link decide a direcao, nao o pedido ==");
ok(P.directionFor(link(), "sale") === "purchase", "link sem venda ignora pedido de venda");
ok(P.directionFor(link(), "purchase") === "purchase", "custo continua custo");
ok(P.directionFor(link({ allow_sale: true }), "sale") === "sale", "link que permite venda respeita o pedido");
ok(P.directionFor(link({ allow_sale: true }), undefined) === "purchase", "sem pedido, o padrao e custo");
ok(P.directionFor(link({ allow_sale: true }), "SALE") === "purchase", "so o valor exato conta, nao a variacao de caixa");
ok(P.directionFor(link(), { toString: () => "sale" }) === "purchase", "objeto disfarcado de string nao passa");

// ------------------------------------------------------------------ LINK
console.log("\n== o link serve agora? ==");
ok(P.linkVerdict(link(), "2026-08-12").ok === true, "link ativo e sem prazo passa");
ok(P.linkVerdict(null, "2026-08-12").reason === "unknown", "link inexistente e 'unknown'");
ok(P.linkVerdict(link({ active: false }), "2026-08-12").reason === "inactive", "revogado e 'inactive'");
ok(P.linkVerdict(link({ expires_at: "2026-08-11" }), "2026-08-12").reason === "expired", "vencido ontem e 'expired'");
ok(P.linkVerdict(link({ expires_at: "2026-08-12" }), "2026-08-12").ok === true, "vence hoje ainda vale hoje");
ok(P.linkVerdict(link({ active: false, expires_at: "2026-08-11" }), "2026-08-12").reason === "inactive",
  "revogado tem precedencia sobre vencido");

// ----------------------------------------------------------------- TOKEN
console.log("\n== forma do token ==");
ok(P.isTokenShape("a7k2f9m3x1q8") === true, "12 minusculas e digitos passa");
ok(P.isTokenShape("a7k2f9m3x1q") === false, "11 nao passa");
ok(P.isTokenShape("A7K2F9M3X1Q8") === false, "maiuscula nao passa");
ok(P.isTokenShape("a7k2f9m3x1q8 ") === false, "espaco colado no fim nao passa");
ok(P.isTokenShape("a7k2-9m3x1q8") === false, "hifen nao passa");
ok(P.isTokenShape(null) === false, "nulo nao passa");
ok(P.isTokenShape(12) === false, "numero nao passa");

// --------------------------------------------------------------- ARQUIVO
console.log("\n== o arquivo pode entrar? ==");
const claim = (over) => Object.assign({ mime_type: "image/jpeg", size: 800 * 1024 }, over);
ok(P.uploadVerdict(claim()).ok === true, "foto de 800 KB passa");
ok(P.uploadVerdict(claim({ mime_type: "image/heic" })).reason === "type", "HEIC nao passa (a tela converte antes)");
ok(P.uploadVerdict(claim({ mime_type: "application/zip" })).reason === "type", "zip nao passa");
ok(P.uploadVerdict(claim({ mime_type: "IMAGE/JPEG" })).ok === true, "caixa alta no tipo nao atrapalha");
ok(P.uploadVerdict(claim({ size: 5 * 1024 * 1024 })).reason === "too_big", "5 MB nao passa (limite da Vercel)");
ok(P.uploadVerdict(claim({ size: P.MAX_UPLOAD_BYTES })).ok === true, "exatamente no teto passa");
ok(P.uploadVerdict(claim({ size: 2000 })).reason === "too_small", "imagem de 2 KB e logo, nao documento");
ok(P.uploadVerdict(claim({ mime_type: "application/pdf", size: 2000 })).ok === true,
  "PDF pequeno passa: PDF de texto puro pode ser pequeno de verdade");
ok(P.uploadVerdict(claim({ size: 0 })).reason === "no_size", "tamanho zero e recusa propria");
ok(P.uploadVerdict(claim({ size: "800000" })).reason === "no_size", "tamanho como texto nao e aceito");
ok(P.uploadVerdict(claim({ size: NaN })).reason === "no_size", "NaN nao vira tamanho");

// ------------------------------------------------------------------ TETO
console.log("\n== teto de envios por link ==");
const times = (n, minutesAgo) => Array.from({ length: n }, () =>
  new Date(Date.parse("2026-08-12T10:00:00Z") - minutesAgo * 60_000).toISOString());
ok(P.rateVerdict([], "2026-08-12T10:00:00Z").ok === true, "primeiro envio passa");
ok(P.rateVerdict(times(39, 1), "2026-08-12T10:00:00Z").ok === true, "39 na janela ainda passa");
ok(P.rateVerdict(times(40, 1), "2026-08-12T10:00:00Z").ok === false, "40 na janela fecha");
ok(P.rateVerdict(times(40, 30), "2026-08-12T10:00:00Z").ok === true,
  "40 de meia hora atras nao contam: a janela e de 10 minutos");
ok(P.rateVerdict(times(40, 30), "2026-08-12T10:00:00Z").used === 0, "e o contador reflete isso");
ok(P.rateVerdict(["nao-e-data"].concat(times(39, 1)), "2026-08-12T10:00:00Z").ok === false,
  "data ilegivel conta como dentro: na duvida limita, senao carimbo corrompido fura o teto");

// --------------------------------------------------------- NOME DO ARQUIVO
console.log("\n== nome do arquivo guardado ==");
const n1 = P.captureFilename("7f3a91", "image/jpeg", "2026-08-12T10:04:00Z");
ok(n1 === "telefone-2026-08-12-7f3a91.jpg", "nome montado do que e confiavel", n1);
ok(P.captureFilename("7f3a91", "application/pdf", "2026-08-12T10:04:00Z").endsWith(".pdf"), "PDF ganha .pdf");
ok(P.captureFilename("7f3a91", "image/png", "2026-08-12T10:04:00Z").endsWith(".png"), "PNG ganha .png");
ok(P.captureFilename("7f3a91", "image/webp", "2026-08-12T10:04:00Z").endsWith(".webp"), "webp ganha .webp");
const mau = P.captureFilename("../../etc/passwd", "image/jpeg", "2026-08-12T10:04:00Z");
ok(!mau.includes("/") && !mau.includes(".."), "id malicioso nao atravessa diretorio", mau);
ok(P.captureFilename("", "image/jpeg", "2026-08-12T10:04:00Z").includes("sem-id"), "id vazio nao gera nome quebrado");
ok(P.captureFilename("7f3a91", "image/jpeg", "hoje").includes("sem-data"), "data invalida nao entra no nome");

// ------------------------------------------------------------- DESCRICAO
console.log("\n== descricao que o analista le ==");
ok(P.captureDescription("Joao (motorista)", null) === "Enviado do telefone por Joao (motorista).",
  "sem nota, diz quem mandou");
ok(P.captureDescription("Joao", "Diesel na M50") === "Enviado do telefone por Joao: Diesel na M50",
  "com nota, junta as duas");
ok(P.captureDescription("", null).includes("nao identificado") === false, "acento nao quebra a comparacao");
ok(P.captureDescription("", null) === "Enviado do telefone por remetente não identificado.",
  "sem nome, diz que nao esta identificado em vez de mentir");
const longa = P.captureDescription("Joao", "x".repeat(500));
ok(longa.length < 340 && longa.endsWith("…"), "nota longa e cortada com reticencia", longa.length);
ok(P.captureDescription("Joao", "   ") === "Enviado do telefone por Joao.", "nota so de espaco e como nota vazia");

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail === 0 ? 0 : 1);
