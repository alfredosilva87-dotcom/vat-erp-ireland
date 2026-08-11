/**
 * Regra por fornecedor (camada B1) — testes.
 *
 * Roda com `npm test`, que compila lib/supplierRules.ts antes.
 *
 * O comportamento mais sutil aqui e o RECONHECIMENTO: numero de VAT bate nome,
 * e nome mais longo bate nome mais curto. Empate entre regras que discordam nao
 * aplica nenhuma — escolher uma no par ou impar seria decidir a conta contabil
 * por sorteio, e ninguem saberia que houve sorteio.
 */
const R = require("../.test-build/supplierRules.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

let n = 0;
const regra = (over) => Object.assign({
  id: "r" + (++n), label: "regra", supplier_vat: null, name_match: "vodafone",
  account_code: "6200", account_name: "Telecomunicacoes", vat_category_code: "STD23",
  extract_line_items: true, active: true,
}, over);
const nota = (over) => Object.assign({
  supplier_name: "Vodafone Ireland Limited", store_name: null, supplier_vat: "IE1234567X",
}, over);

// ------------------------------------------------------ NORMALIZACAO
console.log("\n== o mesmo numero de VAT escrito de varias formas ==");
ok(R.vatKey("IE 1234567 X") === "IE1234567X", "espaco no meio nao muda o numero");
ok(R.vatKey("ie1234567x") === "IE1234567X", "minuscula e o mesmo numero");
ok(R.vatKey("IE-1234567/X") === "IE1234567X", "pontuacao sai");
ok(R.vatKey(null) === "", "nulo vira vazio, nao 'null'");

console.log("\n== pedaco de nome comparado sem acento e sem caixa ==");
ok(R.nameKey("  Café  Central ") === "cafe central", "acento, caixa e espaco duplo");

// ------------------------------------------------------ RECONHECIMENTO
console.log("\n== reconhecer por nome ==");
ok(R.ruleMatchesIdentity(regra(), nota()) === "name",
  "'vodafone' aparece em 'Vodafone Ireland Limited'");
ok(R.ruleMatchesIdentity(regra({ name_match: "vodafone" }), nota({ supplier_name: "VODAFONE PLC" })) === "name",
  "sem ligar para maiuscula");
ok(R.ruleMatchesIdentity(regra({ name_match: "eletricidade" }), nota({ supplier_name: "Eletricidade do Sul" })) === "name",
  "acento no documento nao impede");
ok(!R.ruleMatchesIdentity(regra({ name_match: "aldi" }), nota()), "nome que nao aparece nao casa");

console.log("\n== o nome da loja tambem conta ==");
ok(R.ruleMatchesIdentity(regra({ name_match: "dundrum" }),
  nota({ supplier_name: "Tesco Ireland", store_name: "Tesco Dundrum" })) === "name",
  "a loja entra no que e procurado");

console.log("\n== padrao curto NAO casa ==");
ok(!R.ruleMatchesIdentity(regra({ name_match: "co" }), nota({ supplier_name: "Vodacom" })),
  "'co' aparece em meio mundo de fornecedor e casaria com qualquer um");
ok(R.ruleMatchesIdentity(regra({ name_match: "vod" }), nota({ supplier_name: "Vodacom" })) === "name",
  "tres caracteres ja e permitido");

console.log("\n== reconhecer por numero de VAT ==");
ok(R.ruleMatchesIdentity(regra({ supplier_vat: "ie 1234567 x", name_match: null }), nota()) === "vat",
  "numero casa apesar da forma escrita");
ok(!R.ruleMatchesIdentity(regra({ supplier_vat: "IE9999999Z", name_match: null }), nota()),
  "outro numero nao casa");
ok(!R.ruleMatchesIdentity(regra({ supplier_vat: "IE1234567X", name_match: null }),
  nota({ supplier_vat: null })),
  "nota sem VAT nao casa regra de VAT — vazio nao e curinga");

console.log("\n== inativa nao casa ==");
ok(!R.ruleMatchesIdentity(regra({ active: false }), nota()), "desligada fica desligada");

// ------------------------------------------------------ QUEM GANHA
console.log("\n== numero de VAT ganha do nome ==");
let out = R.matchSupplierRule(nota(), [
  regra({ label: "por nome", name_match: "vodafone", account_code: "6200" }),
  regra({ label: "por VAT", supplier_vat: "IE1234567X", name_match: null, account_code: "6250" }),
]);
ok(out.rule && out.rule.label === "por VAT" && out.matchedBy === "vat",
  "o numero identifica melhor que o nome impresso", out.rule && out.rule.label);

console.log("\n== entre nomes, ganha o mais longo ==");
out = R.matchSupplierRule(nota({ supplier_name: "TESCO EXPRESS DUBLIN", supplier_vat: null }), [
  regra({ label: "generica", name_match: "tesco", account_code: "6000" }),
  regra({ label: "especifica", name_match: "tesco express", account_code: "6001" }),
]);
ok(out.rule && out.rule.label === "especifica",
  "'tesco express' e mais especifico que 'tesco'", out.rule && out.rule.label);

console.log("\n== a especifica ganha independente da ordem de cadastro ==");
out = R.matchSupplierRule(nota({ supplier_name: "TESCO EXPRESS DUBLIN", supplier_vat: null }), [
  regra({ label: "especifica", name_match: "tesco express", account_code: "6001" }),
  regra({ label: "generica", name_match: "tesco", account_code: "6000" }),
]);
ok(out.rule && out.rule.label === "especifica", "cadastrar antes nao da vantagem", out.rule && out.rule.label);

console.log("\n== nenhuma regra, nenhuma decisao ==");
out = R.matchSupplierRule(nota({ supplier_name: "Aldi", supplier_vat: null }), [regra()]);
ok(out.rule === null && out.conflict.length === 0, "sem casar, nada e inventado", out);

// ------------------------------------------------------ EMPATE
console.log("\n== empate que discorda NAO aplica nenhuma ==");
out = R.matchSupplierRule(nota({ supplier_name: "DUNNES STORES", supplier_vat: null }), [
  regra({ label: "por dunnes", name_match: "dunnes", account_code: "6000" }),
  regra({ label: "por stores", name_match: "stores", account_code: "7000" }),
]);
ok(out.rule === null, "duas de mesmo alcance dizendo contas diferentes: nenhuma vale");
ok(out.conflict.length === 2, "e as duas sao devolvidas para a tela poder dizer quais", out.conflict.length);

console.log("\n== empate que concorda aplica ==");
out = R.matchSupplierRule(nota({ supplier_name: "DUNNES STORES", supplier_vat: null }), [
  regra({ label: "por dunnes", name_match: "dunnes", account_code: "6000", vat_category_code: null }),
  regra({ label: "por stores", name_match: "stores", account_code: "6000", vat_category_code: null }),
]);
ok(out.rule !== null && out.conflict.length === 0,
  "cadastro repetido dizendo a mesma coisa nao e ambiguidade — recusar seria alarme falso", out);

console.log("\n== a sobreposicao resolvida pela especificidade nao e conflito ==");
out = R.matchSupplierRule(nota({ supplier_name: "TESCO EXPRESS", supplier_vat: null }), [
  regra({ label: "generica", name_match: "tesco", account_code: "6000" }),
  regra({ label: "especifica", name_match: "tesco express", account_code: "7000" }),
]);
ok(out.rule && out.rule.label === "especifica" && out.conflict.length === 0,
  "'tesco' e 'tesco express' se sobrepoem, mas a especifica ganha — isso e o comportamento, nao defeito", out.rule && out.rule.label);

console.log("\n== regra desligada sai do empate ==");
out = R.matchSupplierRule(nota({ supplier_name: "DUNNES STORES", supplier_vat: null }), [
  regra({ label: "por dunnes", name_match: "dunnes", account_code: "6000", active: false }),
  regra({ label: "por stores", name_match: "stores", account_code: "7000" }),
]);
ok(out.rule && out.rule.label === "por stores",
  "desligar uma das duas e como o contador desfaz o empate", out.rule && out.rule.label);

// ------------------------------------------------------ O QUE A REGRA DECIDE
console.log("\n== campo vazio nao decide nada ==");
let d = R.ruleDecision(regra({ account_code: "6200", vat_category_code: null }));
ok(d.account_code === "6200" && d.vat_category_code === null,
  "so a conta: e assim que um supermercado ganha destino sem perder as aliquotas das linhas", d);
ok(R.ruleDecision(regra({ account_code: "" })).account_code === null, "texto vazio conta como vazio");
ok(R.ruleIsEmpty(regra({ account_code: null, vat_category_code: null })),
  "regra que nao decide nada e nao desliga linha nao faz efeito nenhum");
ok(!R.ruleIsEmpty(regra({ account_code: null, vat_category_code: null, extract_line_items: false })),
  "desligar as linhas ja e um efeito");

// ------------------------------------------------------ LINHA UNICA
console.log("\n== o documento inteiro como uma linha ==");
let line = R.collapseToSingleLine(nota(), { total_net: 100, total_vat: 23, total_gross: 123 });
ok(line.net_amount === 100, "o liquido vem do total do documento", line.net_amount);
ok(line.vat_amount_on_invoice === 23,
  "o VAT vai declarado, e lineVat prefere ele a qualquer aliquota — o credito sai exato", line);
ok(line.vat_rate_on_invoice === 23, "a aliquota do proprio documento, por aritmetica", line.vat_rate_on_invoice);
ok(line.description === "Vodafone Ireland Limited", "a linha se chama como o fornecedor", line.description);

console.log("\n== liquido deduzido quando o documento so traz bruto e VAT ==");
line = R.collapseToSingleLine(nota(), { total_net: null, total_vat: 13.5, total_gross: 113.5 });
ok(line.net_amount === 100, "bruto menos VAT", line.net_amount);

console.log("\n== aliquota irlandesa de casa decimal sobrevive ==");
line = R.collapseToSingleLine(nota(), { total_net: 200, total_vat: 27, total_gross: 227 });
ok(line.vat_rate_on_invoice === 13.5, "13,5% nao e arredondado para 14", line.vat_rate_on_invoice);

console.log("\n== a aliquota da regra manda na deduzida ==");
line = R.collapseToSingleLine(nota(), { total_net: 100, total_vat: 23, total_gross: 123 }, 9);
ok(line.vat_rate_on_invoice === 9, "quem escreveu a regra decidiu", line.vat_rate_on_invoice);

console.log("\n== documento sem VAT ==");
line = R.collapseToSingleLine(nota(), { total_net: null, total_vat: null, total_gross: 50 });
ok(line.net_amount === 50 && line.vat_amount_on_invoice === null && line.vat_rate_on_invoice === null,
  "sem VAT, nada e inventado", line);

console.log("\n== fornecedor sem nome lido ==");
line = R.collapseToSingleLine({ supplier_name: null, store_name: null, supplier_vat: null },
  { total_net: 10, total_vat: 0, total_gross: 10 });
ok(line.description === "Documento sem itens detalhados",
  "a linha nunca fica sem descricao — findOrCreateMaster precisa de uma", line.description);

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========`);
process.exit(fail ? 1 : 0);
