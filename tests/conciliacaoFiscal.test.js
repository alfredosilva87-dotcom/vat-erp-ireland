/**
 * A conciliacao fiscal — testes.
 *
 * O que estas contas existem para apanhar nao da erro em lado nenhum: um
 * documento que entra no periodo e nao e contabilizado, um que e contabilizado
 * com outro valor, ou um lancamento a mao no razao sem documento. Nos tres
 * casos a declaracao e os livros contam historias diferentes, e a UNICA maneira
 * de o ver e por os dois lados lado a lado.
 *
 * Por isso o que se testa aqui e sobretudo o SINAL e o ZERO: uma diferenca com
 * o sinal trocado manda procurar no sitio errado, e uma tolerancia esconderia
 * exactamente o erro que se procura.
 */
const C = require("../.test-build/fiscal/conciliacao.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

console.log("\n== o VAT quando tudo bate ==");
{
  const c = C.conciliarVat({
    de: "2026-01-01", ate: "2026-02-28",
    docSaidas: 3450, docEntradas: 1150,
    razaoSaidas: 3450, razaoEntradas: 1150,
    contaSaidas: "845", contaEntradas: "736",
  });
  ok(c.estado === "fecha", "estado FECHA", c.estado);
  ok(c.diferencaTotal === 0, "diferenca total zero", c.diferencaTotal);
  ok(c.apuracao.aPagar === 2300, "a pagar = 3450 - 1150", c.apuracao);
}

console.log("\n== o VAT a recuperar e negativo, e nao um erro ==");
{
  // Um cliente que investiu no periodo tem mais IVA de entrada do que de saida.
  // Isso e um credito, e a tela tem de o mostrar como tal — nao como divida.
  const c = C.conciliarVat({
    de: "2026-01-01", ate: "2026-02-28",
    docSaidas: 500, docEntradas: 2000,
    razaoSaidas: 500, razaoEntradas: 2000,
    contaSaidas: "845", contaEntradas: "736",
  });
  ok(c.apuracao.aPagar === -1500, "a pagar negativo = a recuperar", c.apuracao.aPagar);
  ok(c.estado === "fecha", "e continua a FECHAR — credito nao e divergencia");
}

console.log("\n== a divergencia, e o SINAL dela ==");
{
  // Um documento entrou na declaracao e NAO foi contabilizado: os documentos
  // dizem mais do que o razao, e a diferenca tem de ser POSITIVA.
  const faltaNoRazao = C.conciliarVat({
    de: "2026-01-01", ate: "2026-02-28",
    docSaidas: 3450, docEntradas: 1150,
    razaoSaidas: 3220, razaoEntradas: 1150,
    contaSaidas: "845", contaEntradas: "736",
  });
  ok(faltaNoRazao.estado === "diverge", "acusa divergencia");
  ok(faltaNoRazao.linhas[0].diferenca === 230,
     "documentos > razao da diferenca POSITIVA", faltaNoRazao.linhas[0].diferenca);

  // O contrario: um lancamento a mao no razao sem documento.
  const sobraNoRazao = C.conciliarVat({
    de: "2026-01-01", ate: "2026-02-28",
    docSaidas: 3450, docEntradas: 1150,
    razaoSaidas: 3680, razaoEntradas: 1150,
    contaSaidas: "845", contaEntradas: "736",
  });
  ok(sobraNoRazao.linhas[0].diferenca === -230,
     "razao > documentos da diferenca NEGATIVA", sobraNoRazao.linhas[0].diferenca);

  // As duas linhas tem de usar a MESMA convencao. Com sinais trocados entre
  // elas, dois problemas iguais apontariam para lados opostos.
  const nasEntradas = C.conciliarVat({
    de: "2026-01-01", ate: "2026-02-28",
    docSaidas: 3450, docEntradas: 1150,
    razaoSaidas: 3450, razaoEntradas: 900,
    contaSaidas: "845", contaEntradas: "736",
  });
  ok(nasEntradas.linhas[1].diferenca === 250,
     "nas entradas, documentos > razao tambem da POSITIVO", nasEntradas.linhas[1].diferenca);
}

console.log("\n== nao ha tolerancia, nem de um centimo ==");
{
  const c = C.conciliarVat({
    de: "2026-01-01", ate: "2026-02-28",
    docSaidas: 3450, docEntradas: 1150,
    razaoSaidas: 3450.01, razaoEntradas: 1150,
    contaSaidas: "845", contaEntradas: "736",
  });
  // Qualquer folga aqui esconde exactamente o erro que isto procura: um IVA
  // arredondado de forma diferente na contabilizacao.
  ok(c.estado === "diverge", "um centimo ja e divergencia", c.linhas[0].diferenca);
  ok(C.TOLERANCIA === 0, "a tolerancia e mesmo zero");
}

console.log("\n== periodo sem movimento nao e nem certo nem errado ==");
{
  const c = C.conciliarVat({
    de: "2026-01-01", ate: "2026-02-28",
    docSaidas: 0, docEntradas: 0, razaoSaidas: 0, razaoEntradas: 0,
    contaSaidas: "845", contaEntradas: "736",
  });
  // Pintar de verde um periodo vazio diria "conferido" sobre nada. E de
  // vermelho seria pior ainda.
  ok(c.estado === "sem_movimento", "diz que nao houve movimento", c.estado);
}

console.log("\n== imposto sobre o lucro ==");
{
  const c = C.conciliarImposto({
    de: "2026-01-01", ate: "2026-12-31", aplicavel: true,
    lucroAntesDeImposto: 80000, despesaDeImposto: 10000,
    movimentoDoPassivo: 10000, contaDespesa: "501", contaPassivo: "831",
  });
  ok(c.estado === "fecha", "despesa e passivo batem");
  ok(c.lucroDepois === 70000, "lucro depois = 80000 - 10000", c.lucroDepois);
  ok(c.taxaEfetiva === 12.5, "taxa efetiva 12.5%", c.taxaEfetiva);
}

console.log("\n== o erro classico de fecho: despesa sem passivo ==");
{
  // Reconhecer a despesa e nao a divida: o lucro depois de imposto sai certo e
  // o balanco fica a dever a diferenca. E o resultado parece perfeito.
  const c = C.conciliarImposto({
    de: "2026-01-01", ate: "2026-12-31", aplicavel: true,
    lucroAntesDeImposto: 80000, despesaDeImposto: 10000,
    movimentoDoPassivo: 0, contaDespesa: "501", contaPassivo: "831",
  });
  ok(c.estado === "diverge", "acusa");
  ok(c.diferencaTotal === 10000, "a diferenca e o imposto inteiro", c.diferencaTotal);
  ok(c.lucroDepois === 70000, "e o lucro depois continua a parecer certo — e o que engana");
}

console.log("\n== a taxa efetiva denuncia o que a lei nao denuncia ==");
{
  // 12,5% e a aliquota de trading. Uma despesa lancada a mais nao rebenta nada;
  // so a taxa efetiva a mostra.
  const c = C.conciliarImposto({
    de: "2026-01-01", ate: "2026-12-31", aplicavel: true,
    lucroAntesDeImposto: 80000, despesaDeImposto: 25000,
    movimentoDoPassivo: 25000, contaDespesa: "501", contaPassivo: "831",
  });
  ok(c.estado === "fecha", "os dois lados batem entre si");
  ok(c.taxaEfetiva === 31.25, "mas a taxa efetiva e 31.25%, longe dos 12.5", c.taxaEfetiva);
  ok(C.CT_TRADING === 12.5 && C.CT_NAO_TRADING === 25, "as aliquotas irlandesas estao la");
}

console.log("\n== prejuizo, e a divisao por zero ==");
{
  const prejuizo = C.conciliarImposto({
    de: "2026-01-01", ate: "2026-12-31", aplicavel: true,
    lucroAntesDeImposto: -5000, despesaDeImposto: 0,
    movimentoDoPassivo: 0, contaDespesa: "501", contaPassivo: "831",
  });
  // "0%" ou "Infinity%" no ecra e pior do que um traco.
  ok(prejuizo.taxaEfetiva === null, "sem lucro nao ha taxa — devolve nulo", prejuizo.taxaEfetiva);
  ok(prejuizo.lucroDepois === -5000, "o prejuizo passa inteiro", prejuizo.lucroDepois);

  const zero = C.conciliarImposto({
    de: "2026-01-01", ate: "2026-12-31", aplicavel: true,
    lucroAntesDeImposto: 0, despesaDeImposto: 0,
    movimentoDoPassivo: 0, contaDespesa: "501", contaPassivo: "831",
  });
  ok(zero.taxaEfetiva === null, "lucro zero tambem nao tem taxa");
}

console.log("\n== o empresario em nome individual nao paga corporation tax ==");
{
  const c = C.conciliarImposto({
    de: "2026-01-01", ate: "2026-12-31", aplicavel: false,
    lucroAntesDeImposto: 40000, despesaDeImposto: 0,
    movimentoDoPassivo: 0, contaDespesa: "501", contaPassivo: "831",
  });
  // O lucro dele e tributado na Form 11, na pessoa. A tela tem de o DIZER, e
  // nao mostrar um quadro a zeros que se le como "nao ha imposto".
  ok(c.aplicavel === false, "marcado como nao aplicavel");
  ok(c.lucroAntesDeImposto === 40000, "e o lucro aparece na mesma — e ele que vai na Form 11");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
