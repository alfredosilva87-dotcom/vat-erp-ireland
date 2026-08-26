/**
 * O motor de lancamento — testes.
 *
 * Roda com `npm test`, que compila lib/accounting/post.ts antes.
 *
 * Contabilidade erra em silencio como nenhuma outra parte deste sistema.
 * Um sinal trocado nao rebenta: o razao fecha, o balancete fecha, e o
 * balanco fica errado por anos. Uma conta de VAT trocada nao rebenta: o
 * VAT3 sai plausivel e o cliente paga a mais. Por isso os testes abaixo
 * conferem CONTA e LADO de cada partida, e nao so o total.
 *
 * Os tres que mais custam se estiverem errados:
 *
 *   1. VAT nao recuperavel indo para "VAT a recuperar" — infla o ativo e
 *      o credito de VAT, e e o que a Revenue encontra.
 *   2. Baixa lancando despesa de novo — dobra o DRE.
 *   3. Diferenca de arredondamento sumindo em vez de aparecer.
 */
const P = require("../.test-build/accounting/post.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
/** Acha a partida de uma conta e devolve {debito, credito}. */
const conta = (linhas, code) => {
  const l = linhas.filter((x) => x.account_code === code);
  return { d: l.reduce((s, x) => s + x.debit, 0), c: l.reduce((s, x) => s + x.credit, 0), n: l.length };
};

console.log("\n== compra: o exemplo do desenho (1000 + 230 VAT) ==");
{
  const linhas = P.postPurchase(
    { supplier_name: "Office Supplies Ltd", invoice_number: "OS-1", total_gross: 1230 },
    [{ net_amount: 1000, vat_amount_on_invoice: 230, account_code: "6200", take_credit: true }]
  );
  ok(P.balanceado(linhas), "o lancamento fecha", { d: P.somaDebito(linhas), c: P.somaCredito(linhas) });
  ok(conta(linhas, "6200").d === 1000, "despesa debitada em 1000", conta(linhas, "6200"));
  ok(conta(linhas, "1300").d === 230, "VAT a recuperar debitado em 230", conta(linhas, "1300"));
  ok(conta(linhas, "2100").c === 1230, "fornecedores creditado no BRUTO", conta(linhas, "2100"));
  // Nenhuma conta de despesa pode ficar do lado credor numa compra.
  ok(conta(linhas, "6200").c === 0, "despesa nao tem credito numa compra");
}

console.log("\n== compra: VAT NAO recuperavel vira custo ==");
{
  // Refeicao: na Irlanda o VAT nao volta. Tem de somar a despesa, e nao
  // pode encostar em "VAT a recuperar".
  const linhas = P.postPurchase(
    { supplier_name: "Cafe Central", total_gross: 123 },
    [{ net_amount: 100, vat_amount_on_invoice: 23, account_code: "6200", take_credit: false }]
  );
  ok(conta(linhas, "6200").d === 123, "despesa leva liquido + VAT = 123", conta(linhas, "6200"));
  ok(conta(linhas, "1300").n === 0, "NAO ha partida em VAT a recuperar", conta(linhas, "1300"));
  ok(conta(linhas, "2100").c === 123, "fornecedores continua no bruto");
  ok(P.balanceado(linhas), "e fecha");
}

console.log("\n== compra: linhas com contas diferentes agrupam ==");
{
  const linhas = P.postPurchase(
    { supplier_name: "Loja", total_gross: 246 },
    [
      { net_amount: 100, vat_amount_on_invoice: 23, account_code: "6200", take_credit: true },
      { net_amount: 100, vat_amount_on_invoice: 23, account_code: "6200", take_credit: true },
    ]
  );
  ok(conta(linhas, "6200").n === 1, "duas linhas na mesma conta viram UMA partida", conta(linhas, "6200"));
  ok(conta(linhas, "6200").d === 200, "com o valor somado");
  ok(conta(linhas, "1300").d === 46, "o VAT tambem soma");
}

console.log("\n== compra: a cadeia de resolucao da conta ==");
{
  const daLinha = P.resolveExpenseAccount("6400", "6200");
  ok(daLinha.code === "6400" && daLinha.resolvedBy === "item", "a conta da linha manda", daLinha);
  const daRegra = P.resolveExpenseAccount(null, "6200");
  ok(daRegra.code === "6200" && daRegra.resolvedBy === "supplier_rule", "sem conta na linha, vale a regra do fornecedor", daRegra);
  const padrao = P.resolveExpenseAccount(null, null);
  ok(padrao.code === "6990" && padrao.resolvedBy === "default", "sem nada, cai na despesa generica", padrao);
  ok(P.resolveExpenseAccount("   ", null).resolvedBy === "default", "conta em branco nao conta como resposta");

  // O elo que respondeu tem de CHEGAR na partida: e a resposta para
  // "por que esta nota foi parar nesta conta".
  const linhas = P.postPurchase({ total_gross: 123 },
    [{ net_amount: 100, vat_amount_on_invoice: 23, take_credit: true }], "6300");
  const despesa = linhas.find((l) => l.account_code === "6300");
  ok(despesa && despesa.resolved_by === "supplier_rule", "a partida grava o elo que resolveu", despesa);
}

console.log("\n== venda: o exemplo do desenho (1000 + 230 VAT) ==");
{
  const linhas = P.postSale({ customer: "Comprador Alfa", doc_number: "SV-1", net_amount: 1000, vat_amount: 230, vat_rate: 23 });
  ok(P.balanceado(linhas), "fecha");
  ok(conta(linhas, "1200").d === 1230, "clientes DEBITADO no bruto", conta(linhas, "1200"));
  ok(conta(linhas, "4100").c === 1000, "receita CREDITADA no liquido", conta(linhas, "4100"));
  ok(conta(linhas, "2200").c === 230, "VAT a pagar creditado em 230", conta(linhas, "2200"));
  // O erro classico: receita no debito, que inverte o DRE inteiro.
  ok(conta(linhas, "4100").d === 0, "receita nunca no debito numa venda");
  ok(conta(linhas, "1200").c === 0, "clientes nunca no credito numa venda");
}

console.log("\n== venda isenta: sem VAT, sem partida de VAT ==");
{
  const linhas = P.postSale({ customer: "X", net_amount: 500, vat_amount: 0 });
  ok(conta(linhas, "2200").n === 0, "nao cria partida de VAT zerada");
  ok(linhas.length === 2 && P.balanceado(linhas), "duas partidas, e fecha", linhas.length);
}

console.log("\n== baixa: o dinheiro fecha o titulo, e NAO repete a despesa ==");
{
  const pagar = P.postSettlement("payable", 1230, "Office Supplies Ltd");
  ok(conta(pagar, "2100").d === 1230, "fornecedores DEBITADO: a divida diminui", conta(pagar, "2100"));
  ok(conta(pagar, "1100").c === 1230, "banco creditado: o dinheiro sai", conta(pagar, "1100"));
  ok(P.balanceado(pagar), "fecha");
  // ESTE e o teste que pega o erro que dobra o DRE.
  const temResultado = pagar.some((l) => /^[456789]/.test(l.account_code) && l.account_code !== "9999");
  ok(!temResultado, "a baixa NAO toca em despesa nem receita", pagar.map((l) => l.account_code));

  const receber = P.postSettlement("receivable", 500, "Cliente Beta");
  ok(conta(receber, "1100").d === 500, "recebimento debita o banco");
  ok(conta(receber, "1200").c === 500, "e credita clientes: o direito diminui");
}

console.log("\n== movimento de banco sem titulo (tarifa, juro) ==");
{
  // Saida: valor negativo no extrato.
  const tarifa = P.postBankDirect(-12.5, "6300", "AIB");
  ok(conta(tarifa, "6300").d === 12.5, "tarifa vira despesa no debito", conta(tarifa, "6300"));
  ok(conta(tarifa, "1100").c === 12.5, "e sai do banco");
  // Entrada.
  const entrada = P.postBankDirect(40, "4900", "Juro");
  ok(conta(entrada, "1100").d === 40, "entrada debita o banco");
  ok(conta(entrada, "4900").c === 40, "e credita o resultado");
}

console.log("\n== arredondamento: a sobra aparece, nunca some ==");
{
  // Bruto da nota nao bate com a soma das linhas por um centimo.
  const linhas = P.postPurchase({ supplier_name: "Y", total_gross: 123.01 },
    [{ net_amount: 100, vat_amount_on_invoice: 23, take_credit: true }]);
  ok(P.balanceado(linhas), "mesmo assim fecha", { d: P.somaDebito(linhas), c: P.somaCredito(linhas) });
  const dif = conta(linhas, "9999");
  ok(dif.n === 1 && dif.d === 0.01, "o centimo vai para a conta de diferencas, no debito", dif);

  // Diferenca para o outro lado.
  const outro = P.postPurchase({ supplier_name: "Y", total_gross: 122.99 },
    [{ net_amount: 100, vat_amount_on_invoice: 23, take_credit: true }]);
  ok(conta(outro, "9999").c === 0.01, "e do lado certo quando a diferenca inverte", conta(outro, "9999"));
}

console.log("\n== diferenca grande NAO e absorvida: estoura ==");
{
  let estourou = false;
  try {
    // 100 euros de diferenca nao e arredondamento, e erro.
    P.postPurchase({ supplier_name: "Z", total_gross: 1000 },
      [{ net_amount: 100, vat_amount_on_invoice: 23, take_credit: true }]);
  } catch (e) {
    estourou = /fora de balanco/i.test(e.message);
  }
  ok(estourou, "acima do teto de 1 euro, o motor recusa em vez de esconder");
}

console.log("\n== centimos: a conta corre em inteiro ==");
{
  // Tres linhas de 33,333 somam 99,99 e a nota diz 100,00 — a diferenca
  // tem de aparecer, nao viajar escondida no arredondamento de cada uma.
  const linhas = P.postPurchase({ supplier_name: "W", total_gross: 100 }, [
    { net_amount: 33.33, vat_amount_on_invoice: 0, account_code: "6100", take_credit: true },
    { net_amount: 33.33, vat_amount_on_invoice: 0, account_code: "6500", take_credit: true },
    { net_amount: 33.33, vat_amount_on_invoice: 0, account_code: "6600", take_credit: true },
  ]);
  ok(P.balanceado(linhas), "fecha");
  ok(P.somaDebito(linhas) === 100 && P.somaCredito(linhas) === 100, "e no valor da nota", {
    d: P.somaDebito(linhas), c: P.somaCredito(linhas),
  });
  ok(conta(linhas, "9999").d === 0.01, "com o centimo visivel", conta(linhas, "9999"));
}

console.log("\n== toda partida e de um lado so ==");
{
  const todas = [
    ...P.postPurchase({ total_gross: 123 }, [{ net_amount: 100, vat_amount_on_invoice: 23, take_credit: true }]),
    ...P.postSale({ net_amount: 1000, vat_amount: 230 }),
    ...P.postSettlement("payable", 50),
  ];
  ok(todas.every((l) => (l.debit === 0) !== (l.credit === 0)),
     "nenhuma partida tem debito e credito juntos, nem os dois zerados");
  ok(todas.every((l) => l.debit >= 0 && l.credit >= 0), "e nenhuma tem valor negativo");
}

// ---------------------------------------------------------------- a folha

/*
 * A provisao da folha.
 *
 * Esta faltava por completo: o titulo nascia em contas a pagar e o razao nunca
 * sabia da folha. Quando ela era paga, a baixa debitava 2400 contra um 2400
 * que nunca tinha sido creditado — conta de PASSIVO com saldo DEVEDOR, a
 * reduzir os credores no balanco — e o salario nunca entrava no DRE.
 *
 * O balanco continuava a fechar, porque a baixa esta balanceada. E por isso
 * que passou despercebido, e e por isso que este teste confere CONTA e LADO.
 */
console.log("\n== a provisao da folha ==");
{
  const l = P.postPayroll(4820.5, "Folha semanal");
  const desp = conta(l, "6950");
  const pass_ = conta(l, "2400");
  ok(desp.d === 4820.5 && desp.c === 0, "salario e DESPESA (debito em 6950)", desp);
  ok(pass_.c === 4820.5 && pass_.d === 0, "folha a pagar e PASSIVO (credito em 2400)", pass_);
  ok(P.balanceado(l), "a provisao fecha");

  // O ciclo completo: provisao + baixa tem de deixar 2400 em ZERO. Se a
  // provisao nao existisse, 2400 ficaria devedora em 4820,50 — o defeito.
  const baixa = P.postSettlement("payable", 4820.5, "Folha", undefined, "1100", "2400");
  const ciclo = [...l, ...baixa];
  const c2400 = conta(ciclo, "2400");
  ok(Math.round((c2400.c - c2400.d) * 100) === 0, "provisao + baixa deixam 2400 em ZERO", c2400);
  const c6950 = conta(ciclo, "6950");
  ok(c6950.d === 4820.5, "e o salario FICA no resultado depois de pago", c6950);
}
{
  // Conta de controlo propria do titulo: o credito tem de seguir a mesma
  // conta que a baixa vai debitar, senao uma sobra com saldo e a outra fica
  // negativa — o mesmo defeito, ao contrario.
  const l = P.postPayroll(1000, null, { ...P.CONTAS_PADRAO, payrollLiability: "2410" }, "6951");
  ok(conta(l, "6951").d === 1000, "conta de despesa propria e respeitada");
  ok(conta(l, "2410").c === 1000, "conta de passivo propria e respeitada");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail === 0 ? 0 : 1);
