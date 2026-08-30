/**
 * As contas da invoice — testes.
 *
 * Uma fatura sai da empresa e vai para as maos de outra. O total que la esta e
 * o que o comprador paga e o que o vendedor declara, entao um centimo de
 * diferenca entre o PDF, a venda gravada e o VAT3 e uma divergencia que alguem
 * vai ter de justificar meses depois, sem se lembrar de nada.
 *
 * A armadilha nao e a multiplicacao. E o ARREDONDAMENTO, e a escolha de onde
 * arredondar tem de ser a mesma em todo o lado.
 */
const I = require("../.test-build/invoicing/calculo.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

console.log("\n== a linha, como no modelo que o Alfredo mandou ==");
{
  // Consulting Services: 15 x 120.00 a 23% -> net 1800, vat 414, total 2214.
  const l = I.calcularLinha({ description: "Consulting", quantity: 15, unitPrice: 120, vatRate: 23 });
  ok(l.net === 1800 && l.vat === 414 && l.gross === 2214, "15 x 120 a 23%", l);

  // Implementation Support: 10 x 95.00 a 23% -> 950 / 218.50 / 1168.50.
  const s = I.calcularLinha({ description: "Support", quantity: 10, unitPrice: 95, vatRate: 23 });
  ok(s.net === 950 && s.vat === 218.5 && s.gross === 1168.5, "10 x 95 a 23%", s);

  // Cloud Hosting: 1 x 300 a 23% -> 300 / 69 / 369.
  const h = I.calcularLinha({ description: "Hosting", quantity: 1, unitPrice: 300, vatRate: 23 });
  ok(h.net === 300 && h.vat === 69 && h.gross === 369, "1 x 300 a 23%", h);
}

console.log("\n== onde se arredonda, e por que importa ==");
{
  // Tres linhas de 33.333 dao 99.999. Arredondar no FIM daria 100.00;
  // arredondar LINHA A LINHA da 99.99. O sistema escolheu linha a linha, porque
  // e assim que a fatura fecha quando o comprador soma a coluna a mao.
  const t = I.calcularInvoice([
    { description: "a", quantity: 1, unitPrice: 33.333, vatRate: 0 },
    { description: "b", quantity: 1, unitPrice: 33.333, vatRate: 0 },
    { description: "c", quantity: 1, unitPrice: 33.333, vatRate: 0 },
  ]);
  ok(t.net === 99.99, "tres linhas de 33.333 somam 99.99, e nao 100.00", t.net);
  ok(t.linhas.every((l) => l.net === 33.33), "cada linha ficou em 33.33", t.linhas.map(l => l.net));

  // A soma das colunas do PDF tem de bater com o total impresso. Se nao bater,
  // e o comprador que descobre.
  const soma = t.linhas.reduce((s, l) => s + l.net, 0);
  ok(Math.abs(soma - t.net) < 0.0001, "a coluna somada a mao bate com o total", { soma, total: t.net });
}

console.log("\n== o meio para cima ==");
{
  ok(I.cent(1.005) === 1.01, "1.005 arredonda para 1.01, e nao para 1.00", I.cent(1.005));
  ok(I.cent(2.675) === 2.68, "2.675 -> 2.68", I.cent(2.675));
  ok(I.cent(0) === 0 && I.cent(NaN) === 0, "zero e lixo dao zero");
  ok(I.cent(-1.005) === -1.01, "o negativo arredonda com a mesma regra", I.cent(-1.005));
}

console.log("\n== o IVA aberto por aliquota ==");
{
  // Uma fatura irlandesa com 23% e 13.5% tem de mostrar os dois separados: um
  // total agregado nao deixa o comprador conferir nem o RTD fechar.
  const t = I.calcularInvoice([
    { description: "servico", quantity: 1, unitPrice: 100, vatRate: 23 },
    { description: "obra", quantity: 1, unitPrice: 200, vatRate: 13.5 },
    { description: "mais servico", quantity: 1, unitPrice: 50, vatRate: 23 },
  ]);
  ok(t.porTaxa.length === 2, "duas aliquotas, dois grupos", t.porTaxa);
  const a23 = t.porTaxa.find((g) => g.rate === 23);
  ok(a23.net === 150 && a23.vat === 34.5, "23%: 150 de base, 34.50 de IVA", a23);
  const a135 = t.porTaxa.find((g) => g.rate === 13.5);
  ok(a135.net === 200 && a135.vat === 27, "13.5%: 200 de base, 27 de IVA", a135);
  ok(t.vat === 61.5 && t.gross === 411.5, "total: 350 + 61.50 = 411.50", { vat: t.vat, gross: t.gross });
  ok(t.porTaxa[0].rate === 23, "a maior aliquota vem primeiro", t.porTaxa.map(g => g.rate));
}

console.log("\n== a data de vencimento a partir dos termos ==");
{
  ok(I.vencimentoDosTermos("2026-03-18", "30 dias") === "2026-04-17", "30 dias a partir de 18/03");
  ok(I.vencimentoDosTermos("2026-03-18", "30 Days") === "2026-04-17", "em ingles tambem");
  ok(I.vencimentoDosTermos("2026-03-18", "Net 30") === "2026-04-17", "'Net 30' tambem");
  ok(I.vencimentoDosTermos("2026-03-18", "a pronto") === "2026-03-18", "a pronto vence no proprio dia");

  // Sem numero reconhecivel NAO se inventa uma data: um vencimento inventado
  // aparece em contas a receber como se fosse verdade, e alguem cobra o cliente
  // no dia errado.
  ok(I.vencimentoDosTermos("2026-03-18", "conforme combinado") === null,
     "termos sem prazo NAO produzem data");
  ok(I.vencimentoDosTermos("2026-03-18", null) === null, "sem termos, sem data");

  // Passagem de mes e de ano, que e onde uma conta feita com +30 dias escorrega.
  ok(I.vencimentoDosTermos("2026-01-31", "30 dias") === "2026-03-02", "31/01 + 30 dias = 02/03 (2026 nao e bissexto)");
  ok(I.vencimentoDosTermos("2026-12-15", "30 dias") === "2027-01-14", "atravessa o ano");
  ok(I.vencimentoDosTermos("2028-02-01", "30 dias") === "2028-03-02", "ano bissexto: 29 de fevereiro conta");
}

console.log("\n== o que impede uma fatura de ser emitida ==");
{
  const linhaBoa = [{ description: "servico", quantity: 1, unitPrice: 100, vatRate: 23 }];

  ok(I.problemasParaEmitir({ customerName: "Alfredo Ltda", issueDate: "2026-03-18", linhas: linhaBoa }).length === 0,
     "fatura completa nao tem problema nenhum");

  // Devolve TUDO de uma vez: parar no primeiro erro obriga a corrigir, gravar,
  // e descobrir o seguinte.
  const vazia = I.problemasParaEmitir({ customerName: "", issueDate: null, linhas: [] });
  ok(vazia.length === 3, "fatura vazia acusa os tres problemas de uma vez", vazia.map(p => p.campo));

  const zero = I.problemasParaEmitir({
    customerName: "X", issueDate: "2026-03-18",
    linhas: [{ description: "servico", quantity: 1, unitPrice: 0, vatRate: 23 }],
  });
  ok(zero.some((p) => /zero/.test(p.mensagem)), "fatura de valor zero e recusada", zero);

  const negativa = I.problemasParaEmitir({
    customerName: "X", issueDate: "2026-03-18",
    linhas: [{ description: "servico", quantity: -1, unitPrice: 100, vatRate: 23 }],
  });
  ok(negativa.some((p) => /nota de cr.dito/.test(p.mensagem)),
     "valor negativo manda emitir nota de credito, e nao passa");

  // O erro caro do lado da emissao: cobrar IVA sem estar registado. O sole
  // trader que o faz cobrou ao comprador um imposto que nao pode entregar.
  const semRegisto = I.problemasParaEmitir({
    customerName: "X", issueDate: "2026-03-18", linhas: linhaBoa, vendedorTemVat: false,
  });
  ok(semRegisto.some((p) => p.campo === "vat"), "cobrar IVA sem registo e recusado", semRegisto);

  const semRegistoA0 = I.problemasParaEmitir({
    customerName: "X", issueDate: "2026-03-18", vendedorTemVat: false,
    linhas: [{ description: "servico", quantity: 1, unitPrice: 100, vatRate: 0 }],
  });
  ok(semRegistoA0.length === 0, "sem registo e a 0% passa — e o caso normal do sole trader");

  // Nao saber se o vendedor tem VAT nao pode BLOQUEAR: a validacao so acusa o
  // que sabe, e um `undefined` nao e um "nao".
  const semSaber = I.problemasParaEmitir({ customerName: "X", issueDate: "2026-03-18", linhas: linhaBoa });
  ok(semSaber.length === 0, "sem informacao sobre o registo, nao inventa impedimento");
}

console.log("\n== linhas em branco nao contam ==");
{
  // A tela abre com linhas vazias para escrever. Elas nao podem virar linhas de
  // 0.00 na fatura impressa.
  const t = I.problemasParaEmitir({
    customerName: "X", issueDate: "2026-03-18",
    linhas: [
      { description: "servico", quantity: 1, unitPrice: 100, vatRate: 23 },
      { description: "", quantity: 0, unitPrice: 0, vatRate: 0 },
      { description: "   ", quantity: 0, unitPrice: 0, vatRate: 0 },
    ],
  });
  ok(t.length === 0, "as linhas em branco sao ignoradas e a fatura passa", t);
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
