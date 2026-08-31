/**
 * Balanco e DRE (Schedule 3A) — testes.
 *
 * O erro que estes testes existem para pegar: **o balanco fora por
 * exatamente o valor do lucro**. Acontece quando o resultado do periodo
 * nao entra em "Profit and loss account" — o relatorio sai bonito, as
 * rubricas parecem certas, e o ativo liquido nao bate com o capital.
 * E o erro mais comum de quem monta balanco a partir de balancete.
 *
 * O segundo: sinal trocado numa rubrica de passivo. Credores entram
 * como saldo POSITIVO (natureza credora) e aparecem NEGATIVOS no
 * relatorio, porque abatem. Trocar isso dobra o passivo em vez de o
 * subtrair, e o balanco fecha por acaso em alguns casos.
 */
const R = require("../.test-build/accounting/reports.js");
/*
 * Os codigos das contas vem de CONTAS_PADRAO, e nao escritos a mao.
 *
 * Estavam cravados ("1200", "2100", ...) e partiram todos de uma vez quando o
 * plano de contas passou a ser o da pratica. O teste estava certo — o que
 * estava errado era ele SABER o codigo. O que tem de garantir e que o cliente
 * e debitado e o fornecedor creditado, seja qual for o codigo que esses papeis
 * tenham no plano em vigor.
 */
const { CONTAS_PADRAO: C } = require("../.test-build/accounting/post.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
const linha = (r, key) => r.lines.find((l) => l.key === key);

/** Os saldos reais do cliente de teste, depois da contabilizacao retroativa. */
const SALDOS = [
  { account_code: C.tradeDebtors, account_name: "Trade debtors",   type: "asset",     report_group: "debtors",                 balance: 3744.35 },
  { account_code: C.tradeCreditors, account_name: "Trade creditors", type: "liability", report_group: "creditors_within_1y",     balance: 482.35 },
  { account_code: C.vatPayable, account_name: "VAT payable",     type: "liability", report_group: "creditors_within_1y",     balance: 689.35 },
  { account_code: C.revenue, account_name: "Sales",           type: "revenue",   report_group: "turnover",                balance: 3055.00 },
  { account_code: C.expenseFallback, account_name: "Other expenses",  type: "expense",   report_group: "administrative_expenses", balance: 482.35 },
];

console.log("\n== a equacao contabil ==");
{
  const e = R.checkEquation(SALDOS);
  ok(e.assets === 3744.35, "ativo", e.assets);
  ok(e.liabilities === 1171.70, "passivo", e.liabilities);
  ok(e.profit === 2572.65, "lucro = receita - despesa", e.profit);
  ok(e.ok && e.difference === 0, "Ativo = Passivo + Patrimonio + Lucro", e);
}

console.log("\n== DRE ==");
{
  const p = R.profitAndLoss(SALDOS);
  ok(linha(p, "turnover").amount === 3055, "turnover positivo", linha(p, "turnover"));
  // Despesa ABATE: aparece negativa no relatorio, ainda que o saldo
  // da conta seja positivo (natureza devedora).
  ok(linha(p, "administrative_expenses").amount === -482.35, "despesa aparece negativa", linha(p, "administrative_expenses"));
  ok(linha(p, "gross_profit").amount === 3055, "sem custo das vendas, lucro bruto = turnover");
  ok(p.profit === 2572.65, "lucro do periodo", p.profit);
  // A soma tem de bater com a conta simples.
  ok(p.profit === 3055 - 482.35, "e confere com receita menos despesa");
}

console.log("\n== BALANCO: fecha com o lucro do periodo dentro ==");
{
  const p = R.profitAndLoss(SALDOS);
  const b = R.balanceSheet(SALDOS, p.profit);
  ok(linha(b, "debtors").amount === 3744.35, "devedores no ativo corrente");
  ok(linha(b, "creditors_within_1y").amount === -1171.70, "credores ate um ano, negativos", linha(b, "creditors_within_1y"));
  ok(linha(b, "net_current_assets").amount === 2572.65, "ativo corrente liquido", linha(b, "net_current_assets"));
  ok(b.netAssets === 2572.65, "ativo liquido", b.netAssets);
  ok(b.capitalAndReserves === 2572.65, "capital e reservas, com o lucro dentro", b.capitalAndReserves);
  ok(b.balances && b.difference === 0, "O BALANCO FECHA", b.difference);
}

console.log("\n== BALANCO: sem o lucro, NAO fecha (o erro classico) ==");
{
  // Reproduz o erro de proposito: monta o balanco esquecendo o resultado.
  const b = R.balanceSheet(SALDOS, 0);
  ok(!b.balances, "sem o lucro do periodo o balanco nao fecha");
  ok(b.difference === 2572.65, "e a diferenca e EXATAMENTE o lucro", b.difference);
}

console.log("\n== BALANCO completo, com abertura e banco ==");
{
  const comAbertura = [
    ...SALDOS,
    { account_code: C.bank, account_name: "Bank",           type: "asset",     report_group: "cash",                balance: 12000 },
    { account_code: "1600", account_name: "Fixed assets",   type: "asset",     report_group: "fixed_assets_tangible", balance: 8000 },
    { account_code: "2600", account_name: "Loans",          type: "liability", report_group: "creditors_after_1y",  balance: 5000 },
    { account_code: "3100", account_name: "Share capital",  type: "equity",    report_group: "share_capital",       balance: 100 },
    { account_code: "3200", account_name: "Retained earnings", type: "equity", report_group: "profit_loss_account", balance: 14900 },
  ];
  const e = R.checkEquation(comAbertura);
  ok(e.ok, "a equacao continua fechando com abertura", e);

  const p = R.profitAndLoss(comAbertura);
  const b = R.balanceSheet(comAbertura, p.profit);
  ok(linha(b, "fixed_assets").amount === 8000, "ativo fixo");
  ok(linha(b, "cash").amount === 12000, "caixa e bancos");
  ok(linha(b, "creditors_after_1y").amount === -5000, "emprestimo, apos um ano, negativo");
  ok(linha(b, "share_capital").amount === 100, "capital social");
  ok(linha(b, "profit_loss_account").amount === 14900 + 2572.65,
     "lucros acumulados + lucro do periodo", linha(b, "profit_loss_account"));
  ok(b.balances && b.difference === 0, "E FECHA", { net: b.netAssets, cap: b.capitalAndReserves, dif: b.difference });
}

console.log("\n== o segundo exercicio: o lucro do ano passado tem de chegar ao patrimonio ==");
{
  /*
   * O bug que este bloco existe para pegar so aparece no SEGUNDO ano, e por
   * isso sobreviveu ao primeiro exercicio inteiro.
   *
   * Os saldos que chegam ao balanco vem ACUMULADOS desde sempre — o ativo ja
   * traz o dinheiro dos dois anos. Enquanto nao ha lancamento de encerramento,
   * o lucro do ano passado continua nas contas de resultado e nao chega ao
   * patrimonio sozinho. Levar ao balanco so o lucro DO PERIODO deixa a
   * diferenca em exatamente a soma dos lucros anteriores.
   *
   * Com um ano de razao os dois numeros sao iguais e nada disto aparece.
   */

  // Ano 1: vendeu 1.000, gastou 400, tudo a prazo. Lucro 600.
  // Ano 2: vendeu 500, gastou 200. Lucro 300. Acumulado: 900.
  const ACUMULADO = [
    { account_code: C.tradeDebtors, account_name: "Trade debtors", type: "asset",   report_group: "debtors",  balance: 1500 },
    { account_code: C.tradeCreditors, account_name: "Trade creditors", type: "liability", report_group: "creditors_within_1y", balance: 600 },
    { account_code: C.revenue, account_name: "Sales",    type: "revenue", report_group: "turnover",      balance: 1500 },
    { account_code: "5100", account_name: "Purchases", type: "expense", report_group: "cost_of_sales", balance: 600 },
  ];
  const lucroAcumulado = R.profitAndLoss(ACUMULADO).profit;
  ok(lucroAcumulado === 900, "lucro acumulado dos dois anos", lucroAcumulado);

  const certo = R.balanceSheet(ACUMULADO, lucroAcumulado);
  ok(certo.balances && certo.difference === 0,
     "com o lucro ACUMULADO, o balanco fecha", { dif: certo.difference });
  ok(certo.capitalAndReserves === 900, "patrimonio = os dois lucros", certo.capitalAndReserves);

  // E a prova ao contrario: com o lucro so do periodo, fica fora por 600 —
  // exatamente o lucro do ano anterior, que e a assinatura deste erro.
  const errado = R.balanceSheet(ACUMULADO, 300);
  ok(!errado.balances && errado.difference === 600,
     "com o lucro do periodo, fica fora pelo lucro do ano anterior", errado.difference);
}

console.log("\n== depois do encerramento, o mesmo numero nao conta duas vezes ==");
{
  /*
   * Se um dia houver lancamento de encerramento, o resultado sai das contas
   * de resultado e passa para `profit_loss_account`. O acumulado das contas de
   * resultado desse periodo fica zero, e o patrimonio nao pode dobrar.
   */
  const DEPOIS = [
    { account_code: C.tradeDebtors, account_name: "Trade debtors", type: "asset", report_group: "debtors", balance: 1500 },
    { account_code: C.tradeCreditors, account_name: "Trade creditors", type: "liability", report_group: "creditors_within_1y", balance: 600 },
    { account_code: "3200", account_name: "Retained earnings", type: "equity", report_group: "profit_loss_account", balance: 900 },
  ];
  const b = R.balanceSheet(DEPOIS, R.profitAndLoss(DEPOIS).profit);
  ok(b.balances && b.difference === 0, "fecha depois do encerramento", { dif: b.difference });
  ok(b.capitalAndReserves === 900, "e o lucro conta uma vez so", b.capitalAndReserves);
}

console.log("\n== rubrica zerada nao polui o relatorio ==");
{
  const p = R.profitAndLoss(SALDOS);
  ok(!p.lines.some((l) => !l.computed && l.amount === 0), "linha vazia nao aparece");
  ok(p.lines.some((l) => l.key === "gross_profit"), "mas as calculadas ficam sempre");
}

console.log("\n== base vazia: nao rebenta, e fecha em zero ==");
{
  const p = R.profitAndLoss([]);
  const b = R.balanceSheet([], p.profit);
  ok(p.profit === 0 && b.balances && b.netAssets === 0, "cliente sem lancamento nenhum", { p: p.profit, b: b.difference });
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail === 0 ? 0 : 1);
