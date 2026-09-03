/**
 * DE ONDE VÊM OS NÚMEROS DO RPN — teste.
 *
 * Três coisas que este teste existe para impedir, e todas as três aconteceram
 * ou eram possíveis no produto:
 *
 * 1. Um número copiado à mão há meses ganhar a um que a Revenue acabou de
 *    mandar.
 * 2. Alguém correr a folha em base CUMULATIVA sem RPN nenhum — a varredura
 *    provou que dava. Sem RPN a regra irlandesa manda emergência, e é também o
 *    lado seguro do erro: desconta a mais e devolve-se, em vez de descontar a
 *    menos e o trabalhador ser cobrado meses depois.
 * 3. Quem entra a meio do ano recomeçar a fatia da taxa normal do princípio,
 *    porque o nosso acumulado só conhece os recibos que nós emitimos.
 */
const { escolherRpn, baseDaRevenue } = require("../.test-build/hr/fiscal/origemDoRpn");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

// Os valores sao os da resposta oficial da Revenue, ja em centimos.
const DA_REVENUE = {
  rpn_number: "5",
  calculation_basis: "CUMULATIVE",
  yearly_tax_credits: 330000,
  yearly_cut_off: 3380000,
  pay_tax_to_date: 123000,
  tax_deducted_to_date: 0,
  usc_deducted_to_date: 1228,
  lpt_to_deduct: 19100,
};

console.log("\n== a Revenue GANHA a tudo ==");
{
  const r = escolherRpn(DA_REVENUE, {
    rpn_cutoff_cents: 999999, rpn_credits_cents: 111111, tax_basis: "semana1",
  });
  ok(r.origem === "revenue", "a origem e a Revenue", r.origem);
  ok(r.cutOffAnual === 3380000, "o cut-off e o DELES, nao o do cadastro", r.cutOffAnual);
  ok(r.creditosAnuais === 330000, "os creditos tambem");
  ok(r.base === "cumulativa", "e a BASE tambem vem deles, e nao do <select> do cadastro", r.base);
  ok(r.lptADescontar === 19100, "e o LPT vem junto");
  ok(r.rpnNumero === "5", "e fica registado QUAL rpn foi usado");
}

console.log("\n== quem entra a meio do ano: o acumulado do outro emprego ==");
{
  const r = escolherRpn(DA_REVENUE, {});
  ok(r.acumuladoDaRevenue !== null, "vem acumulado da Revenue");
  ok(r.acumuladoDaRevenue.bruto === 123000, "1.230,00 ja pagos noutro sitio", r.acumuladoDaRevenue);
  ok(r.acumuladoDaRevenue.paye === 0, "e zero de imposto descontado — zero e um numero, nao uma ausencia");
  ok(r.acumuladoDaRevenue.usc === 1228, "e o USC ja descontado");
}
{
  const semAcumulado = escolherRpn({ rpn_number: "1", calculation_basis: "CUMULATIVE" }, {});
  ok(semAcumulado.acumuladoDaRevenue === null,
    "RPN sem acumulado nenhum nao inventa zeros — nulo e 'nao disseram'");
}

console.log("\n== O CASO QUE A VARREDURA ENCONTROU: cumulativa SEM RPN ==");
{
  // Dava para gravar um funcionario sem PPS, sem RPN e em base cumulativa.
  const r = escolherRpn(null, { tax_basis: "cumulativa" }, true);
  ok(r.origem === "nenhum", "nao ha RPN nenhum");
  ok(r.base === "emergencia", "E A BASE E FORCADA A EMERGENCIA, nao a cumulativa pedida", r.base);
  ok(r.avisos.includes("aviso.semRpn"), "e diz que nao ha RPN");
  ok(r.avisos.includes("aviso.baseForcadaEmergencia"),
    "e diz que a base pedida foi trocada — em silencio seria pior do que o erro");
  ok(r.cutOffAnual === undefined && r.creditosAnuais === undefined,
    "e nao se inventam creditos nem cut-off");
}
{
  // Quem ja pedia emergencia nao precisa do segundo aviso: nada foi trocado.
  const r = escolherRpn(null, { tax_basis: "emergencia" }, true);
  ok(r.base === "emergencia" && !r.avisos.includes("aviso.baseForcadaEmergencia"),
    "quem ja pedia emergencia nao leva aviso de troca");
}

console.log("\n== o cadastro serve, mas diz que e do cadastro ==");
{
  const r = escolherRpn(null, { rpn_cutoff_cents: 3380000, rpn_credits_cents: 330000, tax_basis: "cumulativa" });
  ok(r.origem === "cadastro", "usa o que la esta");
  ok(r.base === "cumulativa", "e ai a base do cadastro vale — ha RPN, ainda que copiado a mao");
  ok(r.avisos.includes("aviso.rpnDoCadastro"),
    "mas o recibo diz que o numero foi copiado a mao, e nao veio da Revenue");
  ok(r.cutOffAnual === 3380000, "com os valores do cadastro");
}
{
  // So um dos dois campos preenchido continua a contar como cadastro.
  const r = escolherRpn(null, { rpn_credits_cents: 330000 });
  ok(r.origem === "cadastro" && r.creditosAnuais === 330000 && r.cutOffAnual === undefined,
    "meio preenchido e melhor do que nada, e o motor completa o resto", r);
}

console.log("\n== 'veio na lista sem RPN' nao e 'nunca perguntamos' ==");
{
  // A Revenue devolve o empregado mesmo sem RPN associado. Para esses e preciso
  // pedir um RPN novo — e tratar isso como se nunca se tivesse perguntado
  // esconderia esse passo.
  const r = escolherRpn({ calculation_basis: "CUMULATIVE", yearly_tax_credits: 330000 }, {}, true);
  ok(r.origem === "nenhum", "sem rpn_number, nao conta como RPN da Revenue", r.origem);
  ok(r.base === "emergencia", "e portanto emergencia");
}

console.log("\n== A REGRA SO APERTA QUANDO HA LIGACAO INSTALADA ==");
{
  // Enquanto nao ha certificado, NINGUEM pode ter RPN. Forcar emergencia ai
  // passaria a carteira toda para emergencia sem forma de sair — armadilha, e
  // nao rigor.
  const semLigacao = escolherRpn(null, { tax_basis: "cumulativa" }, false);
  ok(semLigacao.base === "cumulativa", "sem ligacao, mantem-se o que o cadastro diz", semLigacao.base);
  ok(semLigacao.avisos.includes("aviso.semRpn"),
    "MAS a falta e dita na mesma, desde o primeiro dia");
  ok(!semLigacao.avisos.includes("aviso.baseForcadaEmergencia"),
    "e nao se avisa de uma troca que nao houve");

  const comLigacao = escolherRpn(null, { tax_basis: "cumulativa" }, true);
  ok(comLigacao.base === "emergencia", "com ligacao instalada, a regra aperta");
}

console.log("\n== as palavras da Revenue traduzidas ==");
{
  ok(baseDaRevenue("CUMULATIVE") === "cumulativa", "CUMULATIVE");
  ok(baseDaRevenue("WEEK1") === "semana1", "WEEK1");
  ok(baseDaRevenue("MONTH1") === "semana1", "MONTH1 e a mesma regra");
  ok(baseDaRevenue("EMERGENCY") === "emergencia", "EMERGENCY");
  ok(baseDaRevenue("") === null && baseDaRevenue(null) === null, "vazio e vazio");
  ok(baseDaRevenue("QUALQUER COISA") === "emergencia",
    "uma palavra que nao se reconhece cai no lado SEGURO, nao em cumulativa");
}

console.log(`\n${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
