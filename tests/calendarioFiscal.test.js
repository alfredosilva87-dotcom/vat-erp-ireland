/**
 * O CALENDARIO DE OBRIGACOES — as regras de prazo, com a lei na mao.
 *
 * Estas datas nao dao erro quando estao erradas: a obrigacao aparece na agenda
 * com um prazo plausivel e so se descobre o engano quando chega a coima. E por
 * isso que cada regra tem aqui o seu caso, com a data escrita a mao.
 */
const C = require("../.test-build/fiscal/calendario.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
const acha = (linhas, kind) => linhas.filter((l) => l.kind === kind);
const um = (linhas, kind) => acha(linhas, kind)[0];

console.log("\n== IVA: seis periodos e o resumo anual ==");
{
  const v = C.obrigacoesDeVat(2026);
  ok(acha(v, "VAT3").length === 6, "seis VAT3", acha(v, "VAT3").length);
  ok(v[0].periodStart === "2026-01-01" && v[0].periodEnd === "2026-02-28", "Jan-Fev", v[0]);
  // Vence no dia 23 do mes SEGUINTE ao fim do periodo.
  ok(v[0].dueDate === "2026-03-23", "Jan-Fev vence 23/03", v[0].dueDate);
  ok(um(v, "RTD").dueDate === "2027-01-23", "RTD vence 23/01 do ano seguinte", um(v, "RTD").dueDate);
}

console.log("\n== sociedade: CT1 nove meses depois do fecho ==");
{
  const l = C.obrigacoesDoAno(2026, {
    forma: "limited_company", registadoParaVat: false, fimDoExercicio: "12-31",
  });
  const ct = um(l, "CT1");
  ok(ct.periodStart === "2026-01-01" && ct.periodEnd === "2026-12-31", "exercicio civil", ct);
  ok(ct.dueDate === "2027-09-23", "fecho 31/12/2026 -> CT1 em 23/09/2027", ct.dueDate);

  // O pagamento por conta vence ANTES do fim do proprio exercicio.
  const pre = um(l, "PRELIMINARY_TAX");
  ok(pre.dueDate === "2026-11-23", "preliminary CT em 23/11/2026", pre.dueDate);
}

console.log("\n== exercicio que nao e o ano civil ==");
{
  const l = C.obrigacoesDoAno(2026, {
    forma: "limited_company", registadoParaVat: false, fimDoExercicio: "06-30",
  });
  const ct = um(l, "CT1");
  // O exercicio esta a cavalo em dois anos civis, e conta no ano em que FECHA:
  // po-lo no ano em que comeca fazia a obrigacao aparecer um ano cedo de mais.
  ok(ct.periodStart === "2025-07-01" && ct.periodEnd === "2026-06-30", "julho a junho", ct);
  ok(ct.dueDate === "2027-03-23", "fecho 30/06/2026 -> CT1 em 23/03/2027", ct.dueDate);
  ok(um(l, "PRELIMINARY_TAX").dueDate === "2026-05-23", "preliminary em 23/05/2026",
     um(l, "PRELIMINARY_TAX").dueDate);
}

console.log("\n== a B1 conta 56 dias da data da anual ==");
{
  const l = C.obrigacoesDoAno(2026, {
    forma: "limited_company", registadoParaVat: false, fimDoExercicio: "12-31",
    dataDaAnual: "2019-09-30",
  });
  // A data repete-se todos os anos: usar o ano gravado faria a obrigacao de
  // 2026 vencer numa data de 2019.
  ok(um(l, "B1").dueDate === "2026-11-25", "30/09 + 56 dias = 25/11", um(l, "B1").dueDate);
}

console.log("\n== o que falta no cadastro NAO vira data inventada ==");
{
  const l = C.obrigacoesDoAno(2026, { forma: "limited_company", registadoParaVat: false });
  ok(um(l, "CT1").dueDate === null && um(l, "CT1").falta === "financialYearEnd",
     "sem fecho do exercicio, CT1 sem prazo e a dizer o que falta", um(l, "CT1"));
  ok(um(l, "B1").dueDate === null && um(l, "B1").falta === "annualReturnDate",
     "sem data da anual, B1 sem prazo", um(l, "B1"));
  // agenda.ts pinta de AMARELO a obrigacao sem prazo, precisamente porque e
  // cadastro por completar. Uma data inventada ficava verde e nunca mais era vista.
}

console.log("\n== empresario em nome individual ==");
{
  const l = C.obrigacoesDoAno(2026, { forma: "sole_trader", registadoParaVat: false });
  ok(!acha(l, "CT1").length && !acha(l, "B1").length, "nao tem CT1 nem B1");
  ok(um(l, "FORM11").dueDate === "2027-10-31", "Form 11 de 2026 em 31/10/2027", um(l, "FORM11").dueDate);
  // Duas linhas na mesma data, de proposito: uma acerta o ano passado, a outra
  // antecipa o corrente. Juntas, metade do dinheiro sumia da agenda.
  const pre = um(l, "PRELIMINARY_TAX");
  ok(pre.dueDate === "2027-10-31" && pre.periodLabel === "Preliminary tax 2027",
     "preliminary do ano seguinte, na mesma data", pre);
}

console.log("\n== forma por classificar, e o IVA ==");
{
  ok(C.obrigacoesDoAno(2026, { forma: null, registadoParaVat: false }).length === 0,
     "sem forma juridica nao se adivinha nada");
  const so = C.obrigacoesDoAno(2026, { forma: null, registadoParaVat: true });
  ok(so.length === 7, "mas o IVA existe por si", so.length);
}

console.log("\n== bissexto e fim de mes ==");
{
  const v = C.obrigacoesDeVat(2028);
  ok(v[0].periodEnd === "2028-02-29", "Fevereiro de 2028 tem 29", v[0].periodEnd);
  ok(C.fimDoExercicioEm(2026, "02-30") === "2026-02-28", "30 de Fevereiro cai no ultimo dia real",
     C.fimDoExercicioEm(2026, "02-30"));
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
