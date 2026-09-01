/**
 * A MEMORIA DE CALCULO DO IMPOSTO — os degraus do lucro ate ao que se paga.
 *
 * Este quadro vai para a mao do cliente. Um erro aqui nao aparece como erro:
 * aparece como um numero que ele acredita.
 */
const M = require("../.test-build/fiscal/memoriaDeCalculo.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
const linha = (m, chave) => m.linhas.find((l) => l.chave === chave);

console.log("\n== o caso simples: lucro de exploracao a 12,5% ==");
{
  const m = M.memoriaDeCT({ lucroAntesDeImposto: 11553.32 });
  ok(m.imposto === 1444.17, "11.553,32 a 12,5% = 1.444,17", m.imposto);
  ok(linha(m, "lucroTributavel").valor === 11553.32, "sem ajustes, a base e o lucro");
  ok(linha(m, "basePassivo").valor === 0, "nada de passivo");
  ok(m.taxaEfetiva === 12.5, "taxa efetiva bate com a nominal", m.taxaEfetiva);
  ok(m.porReconhecer === 1444.17, "nada reconhecido ainda");
}

console.log("\n== os ajustes mexem na BASE, nao no imposto ==");
{
  // Representacao nao e dedutivel: soma de volta ao lucro antes de aplicar a taxa.
  const m = M.memoriaDeCT({ lucroAntesDeImposto: 10000, naoDedutivel: 2000, naoTributavel: 500 });
  ok(linha(m, "lucroTributavel").valor === 11500, "10.000 + 2.000 - 500 = 11.500",
     linha(m, "lucroTributavel").valor);
  ok(m.imposto === 1437.5, "11.500 a 12,5% = 1.437,50", m.imposto);
  // A taxa efetiva compara-se com o lucro CONTABIL, que e o que o cliente ve no
  // DRE — e por isso sobe acima dos 12,5% quando ha despesa nao dedutivel.
  ok(m.taxaEfetiva === 14.4, "efetiva 14,4% sobre o lucro contabil", m.taxaEfetiva);
}

console.log("\n== rendimento passivo paga 25% ==");
{
  const m = M.memoriaDeCT({ lucroAntesDeImposto: 20000, rendimentoPassivo: 8000 });
  ok(linha(m, "baseExploracao").base === 12000, "sai de DENTRO do lucro, nao de fora",
     linha(m, "baseExploracao").base);
  ok(linha(m, "baseExploracao").valor === 1500, "12.000 a 12,5% = 1.500");
  ok(linha(m, "basePassivo").valor === 2000, "8.000 a 25% = 2.000");
  ok(m.imposto === 3500, "imposto do exercicio = 3.500", m.imposto);
}

console.log("\n== passivo maior que o lucro nao inventa base ==");
{
  const m = M.memoriaDeCT({ lucroAntesDeImposto: 11000, rendimentoPassivo: 20000 });
  ok(linha(m, "basePassivo").base === 11000 && linha(m, "baseExploracao").base === 0,
     "o passivo e limitado ao lucro tributavel",
     [linha(m, "basePassivo").base, linha(m, "baseExploracao").base]);
  ok(m.imposto === 2750, "11.000 a 25% = 2.750", m.imposto);
}

console.log("\n== prejuizo nao gera imposto negativo ==");
{
  const m = M.memoriaDeCT({ lucroAntesDeImposto: -4000 });
  ok(m.prejuizo === true, "diz que houve prejuizo");
  ok(m.imposto === 0, "imposto zero e nao -500", m.imposto);
  // -500 numa memoria de calculo le-se como reembolso, e nao e isso que
  // acontece: o prejuizo reporta-se, e essa e outra conta.
  ok(m.taxaEfetiva === null, "sem lucro nao ha taxa efetiva");
  ok(linha(m, "basePassivo").valor === 0 && linha(m, "baseExploracao").valor === 0,
     "nenhuma das duas bases gera imposto");
}

console.log("\n== o que ja esta lancado abate no fim, nao na base ==");
{
  const m = M.memoriaDeCT({ lucroAntesDeImposto: 11553.32, jaReconhecido: 1000 });
  ok(m.imposto === 1444.17, "o imposto do exercicio nao muda", m.imposto);
  ok(m.porReconhecer === 444.17, "falta reconhecer 444,17", m.porReconhecer);
}

console.log("\n== reconhecido a MAIS aparece negativo ==");
{
  const m = M.memoriaDeCT({ lucroAntesDeImposto: 10000, jaReconhecido: 2000 });
  // 1.250 devidos com 2.000 lancados: sobra despesa de imposto no resultado, e
  // o sinal negativo e a unica coisa que o diz.
  ok(m.porReconhecer === -750, "por reconhecer = -750", m.porReconhecer);
}

console.log("\n== os degraus aparecem mesmo a zero ==");
{
  const m = M.memoriaDeCT({ lucroAntesDeImposto: 5000 });
  ok(m.linhas.length === 9, "nove degraus, sempre", m.linhas.length);
  // Esconder a linha a zero esconde a PERGUNTA: quem le nao sabe se nao havia
  // despesa nao dedutivel ou se ninguem olhou.
  ok(linha(m, "naoDedutivel").valor === 0 && linha(m, "naoTributavel").valor === 0,
     "os ajustes ficam a vista mesmo vazios");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
