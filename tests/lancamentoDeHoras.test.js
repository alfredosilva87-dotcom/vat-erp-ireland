/**
 * O QUE SE ESCREVE NUMA CELULA DO LIVRO DE HORAS — teste.
 *
 * Este teste existe por causa de um defeito que so apareceu a gravar em
 * producao: a versao anterior devolvia `null` para um campo em branco, e as
 * colunas `hours`, `sunday_hours`, `holiday_hours` e `week_worked` sao NOT NULL
 * com padrao 0/false. O nulo nao gravava "vazio": fazia o Postgres recusar o
 * upsert INTEIRO. Quem apagasse o domingo de uma semana perdia tambem as horas
 * normais que tinha acabado de escrever.
 *
 * Passou despercebido porque a funcao vivia dentro de uma rota, e as rotas so
 * se exercitam com base. Agora e um modulo, e exercita-se sozinha.
 */
const {
  valorDeHoras, valorForcado, colunasDaCelula, MAX_HORAS,
} = require("../.test-build/hr/lancamentoDeHoras");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

console.log("\n== DENTRO DE UMA LINHA, VAZIO E ZERO ==");
{
  ok(valorDeHoras("") === 0, "campo apagado da zero, e nao nulo");
  ok(valorDeHoras(null) === 0, "nulo tambem — a coluna e not null");
  ok(valorDeHoras(undefined) === 0, "e ausente idem");
  ok(valorDeHoras(0) === 0, "zero escrito a mao continua zero");
  ok(valorDeHoras("37,5") === undefined || valorDeHoras("37.5") === 37.5,
    "37.5 e trinta e sete e meia", valorDeHoras("37.5"));
}

console.log("\n== O IMPOSSIVEL NAO SE GRAVA NEM SE CORRIGE ==");
{
  // Corrigir 900 para 168 seria inventar um numero que ninguem escreveu.
  ok(valorDeHoras(900) === undefined, "900 horas numa semana nao existe: nao se toca na coluna");
  ok(valorDeHoras(-5) === undefined, "horas negativas tambem nao");
  ok(valorDeHoras("abc") === undefined, "texto tambem nao");
  ok(valorDeHoras(MAX_HORAS) === 168, "168 e o limite, e cabe");
}

console.log("\n== O BRUTO FORCADO ACEITA NULO, E ESSE E O PONTO ==");
{
  // A coluna e anulavel de proposito: nulo quer dizer "usa as taxas", e zero
  // quer dizer "esta semana paga zero". Sao afirmacoes diferentes.
  ok(valorForcado("") === null, "vazio limpa o valor forcado");
  ok(valorForcado(0) === 0, "zero e um valor forcado de zero, e nao 'sem valor'");
  ok(valorForcado(700) === 700, "e um numero e um numero");
  ok(valorForcado(-1) === undefined, "negativo nao se grava");
}

console.log("\n== SO SE ESCREVE O QUE VEIO NO PEDIDO ==");
{
  // Senao uma tela que edita as horas apagava o domingo que outra pessoa
  // lancou na mesma celula.
  const so = colunasDaCelula({ hours: 40 });
  ok(Object.keys(so).length === 1 && so.hours === 40, "so a coluna pedida", so);

  const tudo = colunasDaCelula({ hours: 32, sundayHours: 8, holidayHours: "", weekWorked: true, grossOverride: "" });
  ok(tudo.hours === 32 && tudo.sunday_hours === 8, "as horas passam");
  ok(tudo.holiday_hours === 0, "o feriado apagado vira zero — e nao rebenta o not null", tudo);
  ok(tudo.week_worked === true, "a marca e booleana");
  ok(tudo.gross_override === null, "e o bruto forcado apagado fica nulo, que a coluna aceita");

  // O CASO QUE REBENTAVA: apagar o domingo numa gravacao que tambem traz horas.
  const apagarDomingo = colunasDaCelula({ hours: 18, sundayHours: null });
  ok(apagarDomingo.sunday_hours === 0 && apagarDomingo.hours === 18,
    "apagar o domingo nao leva as horas normais atras", apagarDomingo);

  const impossivel = colunasDaCelula({ hours: 999, sundayHours: 4 });
  ok(!("hours" in impossivel) && impossivel.sunday_hours === 4,
    "um campo impossivel nao impede os outros de gravar", impossivel);

  ok(Object.keys(colunasDaCelula({})).length === 0, "pedido vazio nao escreve nada");
}

console.log(`\n${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
