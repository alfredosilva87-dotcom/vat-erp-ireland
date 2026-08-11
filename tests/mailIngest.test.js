/**
 * Entrada por e-mail (camada B2) — testes.
 *
 * Roda com `npm test`, que compila lib/mailIngest.ts antes.
 *
 * Os dois comportamentos que mais custam se estiverem errados:
 *   1. O LOGOTIPO da assinatura do fornecedor virando item na fila. Sem filtro,
 *      cada fatura cria dois itens e o escritorio desliga a entrada por e-mail
 *      em uma semana.
 *   2. Mensagem com endereco de DOIS clientes. Escolher o primeiro coloca a nota
 *      de uma empresa dentro de outra, e ninguem descobre.
 */
const M = require("../.test-build/mailIngest.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const rota = (over) => Object.assign({
  client_id: "cliente-A", direction: "purchase", token: "a7k2f9", active: true,
}, over);
const mail = (over) => Object.assign({
  message_id: "<1@fornecedor.ie>", from: "AP <ap@fornecedor.ie>",
  recipients: ["notas+a7k2f9@escritorio.ie"], subject: "Fatura de julho",
  text: "Segue a fatura de julho.", html: null, date: "2026-07-31", attachments: [],
}, over);
const anexo = (over) => Object.assign({
  filename: "fatura.pdf", mime_type: "application/pdf", size: 120000,
  content_id: null, disposition: "attachment",
}, over);

// ------------------------------------------------------------- ENDERECO
console.log("\n== ler o endereco de dentro do cabecalho ==");
ok(M.addressOf("Fornecedor Ltd <AP@Fornecedor.IE>") === "ap@fornecedor.ie", "nome e caixa saem");
ok(M.addressOf("ap@fornecedor.ie") === "ap@fornecedor.ie", "endereco cru tambem serve");
ok(M.domainOf("AP <ap@fornecedor.ie>") === "@fornecedor.ie", "dominio com o arroba");

console.log("\n== o pedaco depois do + e o que identifica o cliente ==");
ok(M.routeTokenOf("notas+a7k2f9@escritorio.ie") === "a7k2f9", "token lido");
ok(M.routeTokenOf("Notas <NOTAS+A7K2F9@escritorio.ie>") === "a7k2f9", "caixa nao importa");
ok(M.routeTokenOf("notas@escritorio.ie") === null,
  "sem + nao ha cliente — nao se adivinha de quem e a nota");
ok(M.routeTokenOf("notas+@escritorio.ie") === null, "+ vazio nao e token");
ok(M.routeTokenOf("bagunca") === null, "texto que nao e endereco");

// ------------------------------------------------------------- ROTEAMENTO
console.log("\n== de quem e a mensagem ==");
let r = M.matchRoute(mail(), [rota()]);
ok(r.route && r.route.client_id === "cliente-A" && r.refusal === null, "endereco do cliente reconhecido", r);

r = M.matchRoute(mail({ recipients: ["escritorio@escritorio.ie", "notas+a7k2f9@escritorio.ie"] }), [rota()]);
ok(r.route !== null, "o endereco do cliente pode estar no meio de outros destinatarios");

r = M.matchRoute(mail({ recipients: ["notas@escritorio.ie"] }), [rota()]);
ok(r.route === null && /Nenhum endereço/.test(r.refusal),
  "sem endereco de cliente, a mensagem fica de fora e diz por que", r.refusal);

r = M.matchRoute(mail(), [rota({ active: false })]);
ok(r.route === null, "endereco desligado deixa de valer");

r = M.matchRoute(mail({ recipients: ["notas+desconhecido@escritorio.ie"] }), [rota()]);
ok(r.route === null, "token que nao existe nao vira cliente nenhum");

console.log("\n== dois clientes na mesma mensagem: recusa, nao sorteio ==");
r = M.matchRoute(
  mail({ recipients: ["notas+a7k2f9@escritorio.ie", "notas+b8m3x1@escritorio.ie"] }),
  [rota(), rota({ client_id: "cliente-B", token: "b8m3x1" })]
);
ok(r.route === null && /mais de um destino/.test(r.refusal),
  "nao ha como saber de quem e o anexo", r.refusal);

console.log("\n== compra e venda do MESMO cliente tambem sao destinos diferentes ==");
r = M.matchRoute(
  mail({ recipients: ["notas+a7k2f9@escritorio.ie", "notas+z9p1q2@escritorio.ie"] }),
  [rota(), rota({ direction: "sale", token: "z9p1q2" })]
);
ok(r.route === null && /mais de um destino/.test(r.refusal),
  "a nota entraria como compra e como venda ao mesmo tempo", r.refusal);

console.log("\n== o mesmo endereco repetido nao e ambiguidade ==");
r = M.matchRoute(
  mail({ recipients: ["notas+a7k2f9@escritorio.ie", "Notas <notas+A7K2F9@escritorio.ie>"] }),
  [rota()]
);
ok(r.route !== null, "To e Cc com o mesmo endereco e um destino, nao dois", r.refusal);

// ------------------------------------------------------------- REMETENTE
console.log("\n== caixa sem lista nenhuma esta aberta ==");
let v = M.senderVerdict("ap@fornecedor.ie", [], "cliente-A");
ok(v.ok, "quem ligou a entrada e nao cadastrou remetente quer receber", v);

console.log("\n== bloqueio ==");
v = M.senderVerdict("spam@ruim.com", [{ pattern: "spam@ruim.com", mode: "block", client_id: null }], "cliente-A");
ok(!v.ok && /bloqueado/.test(v.reason), "endereco bloqueado", v);
v = M.senderVerdict("qualquer@ruim.com", [{ pattern: "@ruim.com", mode: "block", client_id: null }], "cliente-A");
ok(!v.ok, "dominio bloqueado pega o dominio inteiro", v);
v = M.senderVerdict("ap@bom.ie", [{ pattern: "@ruim.com", mode: "block", client_id: null }], "cliente-A");
ok(v.ok, "dominio parecido nao e o mesmo dominio", v);

console.log("\n== liberacao fecha a porta para o resto ==");
const soFornecedor = [{ pattern: "@fornecedor.ie", mode: "allow", client_id: "cliente-A" }];
ok(M.senderVerdict("ap@fornecedor.ie", soFornecedor, "cliente-A").ok, "quem esta na lista passa");
ok(!M.senderVerdict("outro@estranho.com", soFornecedor, "cliente-A").ok, "quem nao esta, nao passa");

console.log("\n== bloqueio ganha da liberacao ==");
v = M.senderVerdict("ap@fornecedor.ie", [
  { pattern: "@fornecedor.ie", mode: "allow", client_id: "cliente-A" },
  { pattern: "ap@fornecedor.ie", mode: "block", client_id: "cliente-A" },
], "cliente-A");
ok(!v.ok, "quem bloqueia esta corrigindo algo que ja aconteceu", v);

console.log("\n== lista de um cliente nao fecha a caixa do outro ==");
ok(M.senderVerdict("ap@fornecedor.ie", soFornecedor, "cliente-B").ok,
  "a liberacao de A nao e uma exigencia para B");
v = M.senderVerdict("ap@fornecedor.ie", [{ pattern: "ap@fornecedor.ie", mode: "block", client_id: "cliente-B" }], "cliente-A");
ok(v.ok, "e o bloqueio de B tambem nao vale para A", v);

console.log("\n== mensagem sem remetente ==");
ok(!M.senderVerdict(null, [], "cliente-A").ok, "sem remetente nao passa");

// ------------------------------------------------------------- ANEXOS
console.log("\n== o que e documento e o que e enfeite ==");
let d = M.selectAttachments(mail({ attachments: [anexo()] }));
ok(d.length === 1 && d[0].keep, "PDF entra");

d = M.selectAttachments(mail({ attachments: [
  anexo(),
  anexo({ filename: "logo.png", mime_type: "image/png", size: 3200, content_id: "<logo@x>", disposition: "inline" }),
]}));
ok(d[0].keep && !d[1].keep, "o logotipo da assinatura NAO vira item na fila", d.map(x => x.keep));
ok(/logotipo|assinatura/i.test(d[1].reason), "e o motivo fica registrado", d[1].reason);

d = M.selectAttachments(mail({ attachments: [
  anexo({ filename: "logo.png", mime_type: "image/png", size: 3200, content_id: null, disposition: "attachment" }),
]}));
ok(!d[0].keep && /pequena/.test(d[0].reason),
  "logo mandado como anexo comum tambem cai, pelo tamanho", d[0].reason);

d = M.selectAttachments(mail({ attachments: [
  anexo({ filename: "recibo.jpg", mime_type: "image/jpeg", size: 250000, content_id: null, disposition: "attachment" }),
]}));
ok(d[0].keep, "foto de recibo passa com folga do limite de tamanho");

d = M.selectAttachments(mail({ attachments: [anexo({ filename: "nota.pdf", size: 1200 })] }));
ok(d[0].keep, "PDF pequeno continua valendo — nota de texto puro e leve mesmo");

d = M.selectAttachments(mail({ attachments: [
  anexo({ filename: "planilha.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  anexo({ filename: "assinatura.vcf", mime_type: "text/vcard", size: 900 }),
]}));
ok(!d[0].keep && !d[1].keep, "tipo que a leitura nao sabe ler fica de fora");
ok(/Tipo não aceito/.test(d[0].reason), "dizendo qual era o tipo", d[0].reason);

console.log("\n== tres anexos de verdade, tres itens ==");
d = M.selectAttachments(mail({ attachments: [
  anexo({ filename: "a.pdf" }), anexo({ filename: "b.pdf" }), anexo({ filename: "c.pdf" }),
]}));
ok(d.filter(x => x.keep).length === 3, "um item por anexo", d.length);

console.log("\n== nome de arquivo ==");
ok(M.safeFilename(anexo({ filename: "../../etc/passwd" }), 0) === "..-..-etc-passwd",
  "barra sai do nome, para nao virar caminho");
ok(M.safeFilename(anexo({ filename: null }), 2) === "anexo-3.pdf", "anexo sem nome ganha um");
ok(M.safeFilename(anexo({ filename: "  ", mime_type: "image/jpeg" }), 0) === "anexo-1.jpeg", "nome em branco tambem");

// ------------------------------------------------------------- CORPO
console.log("\n== o corpo do e-mail vira descricao ==");
ok(M.bodyDescription(mail({ text: "Segue a fatura de julho." })) === "Segue a fatura de julho.",
  "o recado que veio com a nota");

ok(M.bodyDescription(mail({ text: null, html: "<p>Segue a <b>fatura</b> de julho.</p>" })) === "Segue a fatura de julho.",
  "e-mail so em HTML tambem tem corpo");

ok(M.bodyDescription(mail({ text: null, html: "<style>p{color:red}</style><p>Fatura</p>" })) === "Fatura",
  "estilo dentro do HTML nao e texto");

let body = M.bodyDescription(mail({ text: "Segue a fatura.\n\nEm 30 de julho, Fornecedor escreveu:\n> mensagem anterior inteira" }));
ok(body === "Segue a fatura.", "a resposta citada e cortada: o recado novo esta em cima", body);

body = M.bodyDescription(mail({ text: "Segue a fatura.\n--\nJoao\nDiretor Financeiro" }));
ok(body === "Segue a fatura.", "assinatura cortada no separador", body);

body = M.bodyDescription(mail({ text: "Fatura.\n\n----- Original Message -----\nlixo" }));
ok(body === "Fatura.", "mensagem original repassada tambem", body);

body = M.bodyDescription(mail({ text: "x".repeat(1500) }));
ok(body.length === M.BODY_LIMIT + 1 && body.endsWith("…"), "corpo enorme e cortado com reticencia", body.length);

ok(M.bodyDescription(mail({ text: "   \n  \n" })) === null, "corpo vazio e nulo, nao string vazia");
ok(M.bodyDescription(mail({ text: null, html: null })) === null, "e-mail sem corpo nenhum");

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========`);
process.exit(fail ? 1 : 0);
