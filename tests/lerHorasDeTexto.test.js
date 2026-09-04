/**
 * LER AS HORAS DE UMA MENSAGEM DE WHATSAPP — teste.
 *
 * As mensagens deste teste são escritas como as pessoas escrevem: sem formato,
 * ao domingo à noite, do telemóvel. Não há como as obrigar a um formulário — o
 * que há é ler o melhor possível e deixar a conferência numa pessoa.
 *
 * A regra que este teste guarda acima de todas: **na dúvida, não adivinhar**.
 * Uma linha que não se percebe fica em `naoLidas`, com o texto original. Nunca
 * vira zero horas — um zero inventado é um salário a menos, e ninguém vai à
 * procura de uma linha que nunca apareceu.
 */
const { lerHorasDeTexto } = require("../.test-build/hr/lerHorasDeTexto");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
const acha = (r, nome) => r.linhas.find((l) => l.nome.toLowerCase().includes(nome.toLowerCase()));

console.log("\n== A MENSAGEM TIPICA, como ela chega mesmo ==");
{
  const r = lerHorasDeTexto(`Boa noite! Semana 36
João 39
Maria - 42.5h
Pedro 38 (4 domingo)
A Ana não trabalhou esta semana`);

  ok(r.semana === 36, "a semana sai do cabecalho", r.semana);
  ok(r.linhas.length === 4, "quatro pessoas", r.linhas.map((l) => l.nome));
  ok(r.naoLidas.length === 0, "e nada ficou por ler", r.naoLidas);

  ok(acha(r, "João").horas === 39, "39 simples");
  ok(acha(r, "Maria").horas === 42.5, "42.5h com ponto e com o 'h' colado", acha(r, "Maria").horas);
  ok(acha(r, "Pedro").horas === 38 && acha(r, "Pedro").horasDomingo === 4,
    "38 no total e 4 ao domingo, com a etiqueta DEPOIS do numero", acha(r, "Pedro"));
  // O defeito que isto fecha: as colunas SOMAM-SE no bruto, entao gravar 38 a
  // par das 4 pagava 42 horas — quatro a mais por semana, e 42 e plausivel
  // que chegue para ninguem estranhar.
  ok(acha(r, "Pedro").horasNormais === 34,
    "e o que vai para as horas normais e 34, para o total continuar a ser 38",
    acha(r, "Pedro").horasNormais);
  ok(acha(r, "Ana").trabalhou === false && acha(r, "Ana").horas === 0,
    "e quem nao trabalhou fica marcado, com zero explicito", acha(r, "Ana"));
  // Apanhado a olhar para a producao: o nome saia "A Ana ou esta semana",
  // porque so as palavras que casavam eram apagadas e os restos ficavam.
  ok(acha(r, "Ana").nome === "Ana",
    "e o NOME e so o nome — sem o artigo nem os restos da frase", acha(r, "Ana").nome);
  ok(!/boa noite/i.test(r.linhas.map((l) => l.nome).join(" ")), "a saudacao nao virou pessoa");
}

console.log("\n== O TOTAL NAO E UMA PARCELA ==");
{
  // Quem escreve "40 domingo 8" quer dizer 40 no total. Somar as duas colunas
  // dava 48.
  const r = lerHorasDeTexto("Tiago 40 domingo 8");
  ok(acha(r, "Tiago").horas === 40, "o total escrito e 40");
  ok(acha(r, "Tiago").horasNormais === 32, "e 32 + 8 volta a dar 40", acha(r, "Tiago").horasNormais);

  const f = lerHorasDeTexto("Ines 32 (8 feriado)");
  ok(acha(f, "Ines").horasNormais === 24, "o feriado sai do total pela mesma razao", acha(f, "Ines"));

  const dois = lerHorasDeTexto("Rita 40 (8 domingo, 8 feriado)");
  ok(acha(dois, "Rita").horasNormais === 24, "e as duas parcelas juntas tambem", acha(dois, "Rita"));

  const sem = lerHorasDeTexto("Bruno 39");
  ok(acha(sem, "Bruno").horasNormais === 39, "sem parcelas, normais = total");
}

console.log("\n== QUANDO A CONTA NAO FECHA, NAO SE CORRIGE ==");
{
  // O "total" menor do que a parte quer dizer que a suposicao esta errada — e
  // nao ha maneira de saber qual dos dois numeros e que esta mal.
  const r = lerHorasDeTexto("Nuno 4 domingo 8");
  ok(acha(r, "Nuno").horasNormais === 4, "os numeros ficam como vieram", acha(r, "Nuno"));
  ok(acha(r, "Nuno").aviso === "wa.somaNaoBate",
    "e a linha leva aviso, para quem aprova decidir", acha(r, "Nuno").aviso);
  ok(acha(r, "Nuno").horasNormais >= 0, "e nunca sai um numero negativo");
}

console.log("\n== A REGRA QUE MAIS IMPORTA: na duvida NAO adivinhar ==");
{
  const r = lerHorasDeTexto(`Semana 40
Carlos 38
o resto mando amanha
falar com a contabilidade sobre o Nuno`);
  ok(r.linhas.length === 1 && acha(r, "Carlos"), "so o Carlos foi lido");
  ok(r.naoLidas.length === 2, "as outras duas ficam a vista, com o texto original", r.naoLidas);
  ok(r.naoLidas.some((l) => /Nuno/.test(l)),
    "e a que fala do Nuno NAO virou 'Nuno, 0 horas' — que seria um salario a menos");
}

console.log("\n== a virgula decimal, que e como se escreve ca ==");
{
  const r = lerHorasDeTexto("Sofia 37,5");
  ok(acha(r, "Sofia").horas === 37.5, "37,5 e trinta e sete e meia", acha(r, "Sofia").horas);
}

console.log("\n== 8:30 e meia hora, e nao trinta ==");
{
  // Quem vem de um relogio de ponto escreve assim. Ler 8:30 como 8,30 daria
  // 8h18 — uma diferenca pequena o suficiente para nunca ser notada.
  const r = lerHorasDeTexto("Rui 38:30");
  ok(acha(r, "Rui").horas === 38.5, "38:30 sao 38 horas e meia", acha(r, "Rui").horas);
}

console.log("\n== a etiqueta pode vir antes ou depois do numero ==");
{
  const a = lerHorasDeTexto("Tiago 40 domingo 8");
  const b = lerHorasDeTexto("Tiago 40 8 domingo");
  ok(acha(a, "Tiago").horasDomingo === 8, "'domingo 8'", acha(a, "Tiago"));
  ok(acha(b, "Tiago").horasDomingo === 8, "'8 domingo'", acha(b, "Tiago"));
  ok(acha(a, "Tiago").horas === 40 && acha(b, "Tiago").horas === 40, "e o total continua a ser 40");
}

console.log("\n== feriado tem coluna propria ==");
{
  const r = lerHorasDeTexto("Ines 32 (8 feriado)");
  ok(acha(r, "Ines").horasFeriado === 8, "8 de feriado", acha(r, "Ines"));
  ok(acha(r, "Ines").horas === 32, "e 32 no total");
}

console.log("\n== o nome sai limpo, sem as palavras nem a pontuacao ==");
{
  const r = lerHorasDeTexto("- Ana Maria Silva ....... 40 hrs");
  ok(r.linhas[0].nome === "Ana Maria Silva", "nome inteiro, sem tracos nem 'hrs'", r.linhas[0].nome);
  ok(r.linhas[0].origem.includes("hrs"), "e a linha ORIGINAL fica, para quem confere comparar");
}

console.log("\n== as tres linguas do produto ==");
{
  const en = lerHorasDeTexto("Week 12\nJohn 40\nMary didn't work");
  ok(en.semana === 12, "Week 12");
  ok(acha(en, "Mary").trabalhou === false, "\"didn't work\" tambem e lido");
  const es = lerHorasDeTexto("Semana 5\nCarlos no trabajó");
  ok(acha(es, "Carlos")?.trabalhou === false, "\"no trabajó\" tambem");
}

console.log("\n== numeros impossiveis nao passam por horas ==");
{
  // 2026 e um ano, nao horas. E ninguem faz 900 horas numa semana.
  const r = lerHorasDeTexto("Semana 3\nJorge 900");
  ok(r.linhas.length === 0 && r.naoLidas.length === 1,
    "900 horas numa semana nao existe: fica por ler em vez de virar numero", r);
}

console.log("\n== sem cabecalho de semana, quem confere escolhe ==");
{
  const r = lerHorasDeTexto("Marta 40\nHugo 38");
  ok(r.semana === null, "nao se INVENTA a semana — seria lancar horas no sitio errado", r.semana);
  ok(r.linhas.length === 2, "mas as pessoas leem-se na mesma");
}

console.log("\n== mensagem vazia ou so saudacao ==");
{
  ok(lerHorasDeTexto("").linhas.length === 0, "vazia nao rebenta");
  ok(lerHorasDeTexto(null).linhas.length === 0, "nula tambem");
  const so = lerHorasDeTexto("Bom dia!\nObrigado");
  ok(so.linhas.length === 0 && so.naoLidas.length === 0, "so saudacoes: nada lido e nada por ler", so);
}

console.log(`\n${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
