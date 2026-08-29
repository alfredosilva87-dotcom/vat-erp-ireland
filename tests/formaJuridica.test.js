/**
 * A forma juridica e o que decorre dela — testes.
 *
 * Duas coisas custam caro se estiverem erradas, e nenhuma rebenta:
 *
 *   1. Mostrar a obrigacao errada. Um CT1 cobrado a um empresario em nome
 *      individual nao da erro nenhum: da uma agenda plausivel e falsa, e
 *      ensina quem a le a fechar o aviso sem ler.
 *
 *   2. O limiar de VAT. Quem passa e nao se regista deve o IVA das vendas que
 *      fez sem o cobrar, e paga-o do proprio bolso. Avisar tarde custa dinheiro
 *      ao cliente; avisar cedo custa uma conversa.
 */
const F = require("../.test-build/fiscal/formaJuridica.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
const tipos = (l) => l.map((o) => o.tipo).sort();

console.log("\n== que obrigacoes cada forma tem ==");
{
  const s = F.obrigacoesDa("sole_trader", true);
  ok(JSON.stringify(tipos(s)) === JSON.stringify(["FORM11", "PRELIMINARY_TAX", "RTD", "VAT3"]),
     "sole trader com VAT: Form 11, preliminary, VAT3 e RTD", tipos(s));
  ok(!tipos(s).includes("CT1") && !tipos(s).includes("B1"),
     "e NAO leva CT1 nem B1 — isso e de sociedade");
}
{
  const l = F.obrigacoesDa("limited_company", true);
  ok(JSON.stringify(tipos(l)) === JSON.stringify(["B1", "CT1", "RTD", "VAT3"]),
     "sociedade com VAT: CT1, B1, VAT3 e RTD", tipos(l));
  ok(!tipos(l).includes("FORM11"), "e NAO leva Form 11 — isso e do empresario");
}
{
  const s = F.obrigacoesDa("sole_trader", false);
  ok(!tipos(s).includes("VAT3") && !tipos(s).includes("RTD"),
     "sem registo de VAT, as obrigacoes de VAT nao aparecem", tipos(s));
  ok(tipos(s).includes("FORM11"), "mas as de imposto sobre o rendimento continuam");
}
{
  // Forma por preencher devolve VAZIO, e nao uma lista provavel: adivinhar
  // daria uma agenda que parece completa e esta errada.
  ok(F.obrigacoesDa(null, true).length === 0, "forma por preencher = lista vazia");
  ok(F.obrigacoesDa(undefined, false).length === 0, "undefined tambem");
}

console.log("\n== o limiar de VAT ==");
{
  ok(F.avisoDeLimiarVat(500000, true) === null, "ja registado nao gera aviso nenhum");
}
{
  const a = F.avisoDeLimiarVat(10000, false);
  ok(a.estado === "ok", "bem abaixo = ok", a);
  ok(a.usoDoMenorLimiar === 24, "e diz a percentagem do limiar de servicos", a);
}
{
  // A fronteira dos 80%: 42.500 * 0.8 = 34.000.
  ok(F.avisoDeLimiarVat(33999, false).estado === "ok", "33.999 ainda e ok");
  ok(F.avisoDeLimiarVat(34000, false).estado === "aproxima", "34.000 ja avisa (80%)");
}
{
  // A fronteira do limiar de SERVICOS, que e o mais apertado dos dois.
  ok(F.avisoDeLimiarVat(42499, false).estado === "aproxima", "42.499 ainda e aviso");
  const p = F.avisoDeLimiarVat(42500, false);
  ok(p.estado === "passou", "42.500 passou o limiar de servicos", p);
  ok(/SERVI/i.test(p.mensagem), "e a mensagem diz que e o de servicos", p.mensagem);
}
{
  // Acima do limiar de BENS os dois foram ultrapassados, e a mensagem muda.
  const p = F.avisoDeLimiarVat(85000, false);
  ok(p.estado === "passou", "85.000 passou os dois");
  ok(/dois limiares/i.test(p.mensagem), "e a mensagem diz que foram os dois", p.mensagem);
}
{
  // Valor invalido nao rebenta nem inventa: trata-se como zero.
  const z = F.avisoDeLimiarVat(NaN, false);
  ok(z.estado === "ok" && z.faturamento === 0, "faturamento invalido conta como zero", z);
  const n = F.avisoDeLimiarVat(-5000, false);
  ok(n.faturamento === 0, "negativo tambem", n);
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail === 0 ? 0 : 1);
