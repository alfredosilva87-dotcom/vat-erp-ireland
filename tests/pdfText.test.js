/**
 * O PDF ENTREGUE AO CLIENTE NÃO COME OS ACENTOS — teste.
 *
 * As quatro primeiras asserções são as quatro linhas exactas que saíram
 * estropiadas do `bundle.pdf` na varredura de ponta a ponta. Se alguma delas
 * voltar a falhar, o defeito voltou.
 *
 * As restantes guardam a razão de ser da guarda original: o arquivo tem de
 * sair SEMPRE. Tirar os acentos era a maneira errada de garantir isso; deixar
 * de garantir seria trocar um defeito feio por um pior.
 */
const { winAnsiSafe, ehWinAnsi } = require("../.test-build/pdfText");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

console.log("\n== AS QUATRO LINHAS QUE SAIRAM ESTROPIADAS ==");
ok(winAnsiSafe("até") === "até", 'ate -> ate', winAnsiSafe("até"));
ok(winAnsiSafe("Saídas") === "Saídas", '"Saidas" volta a ser "Saídas"', winAnsiSafe("Saídas"));
ok(winAnsiSafe("Número") === "Número", '"Numero" volta a ser "Número"', winAnsiSafe("Número"));
ok(winAnsiSafe("lançamento(s)") === "lançamento(s)", '"lancamento" volta a ser "lançamento"', winAnsiSafe("lançamento(s)"));

console.log("\n== o travessao tambem caia, e nao devia ==");
ok(winAnsiSafe("Entradas — Saídas") === "Entradas — Saídas", "o travessao e WinAnsi e fica", winAnsiSafe("Entradas — Saídas"));
ok(winAnsiSafe("O'Brien’s") === "O'Brien’s", "a aspa curva e WinAnsi e fica", winAnsiSafe("O'Brien’s"));

console.log("\n== o portugues e o irlandes inteiros passam ==");
ok(winAnsiSafe("Ação, coração, José, Ávila, ümlaut, ñ") === "Ação, coração, José, Ávila, ümlaut, ñ", "acentos latinos todos");
ok(winAnsiSafe("Dún Laoghaire · Ó Súilleabháin") === "Dún Laoghaire · Ó Súilleabháin", "nomes irlandeses");
ok(winAnsiSafe("€ 1.234,56") === "€ 1.234,56", "o simbolo do euro (0x80 no CP1252)");

console.log("\n== o que a fonte NAO sabe desenhar continua a nao rebentar ==");
// Era esta a preocupacao original, e continua servida.
ok(winAnsiSafe("Zoë Māori") === "Zoe Maori" || winAnsiSafe("Zoë Māori") === "Zoë Maori",
  "o macron (fora do CP1252) decompoe-se em vez de rebentar", winAnsiSafe("Zoë Māori"));
ok(winAnsiSafe("Łódź") === "Łódź".normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/Ł/, "L") || typeof winAnsiSafe("Łódź") === "string",
  "polaco nao rebenta", winAnsiSafe("Łódź"));
ok(/^[\x20-\x7E\xA0-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/.test(winAnsiSafe("日本語テキスト", 60, "-")),
  "japones sai sem deixar bytes que a fonte nao desenha", winAnsiSafe("日本語テキスト"));
ok(winAnsiSafe("日本語") === "-", "e quando nao sobra nada, devolve o marcador", winAnsiSafe("日本語"));
ok(winAnsiSafe("🧾 recibo") === "recibo", "emoji sai e o resto fica", winAnsiSafe("🧾 recibo"));

console.log("\n== o corte de comprimento continua a existir ==");
ok(winAnsiSafe("A".repeat(200)).length === 60, "corta nos 60 por omissao");
ok(winAnsiSafe("A".repeat(200), 10).length === 10, "e no que se pedir");
ok(winAnsiSafe("Coração".repeat(50), 7) === "Coração", "corta contando caracteres, nao bytes", winAnsiSafe("Coração".repeat(50), 7));

console.log("\n== nulo e vazio ==");
ok(winAnsiSafe(null) === "-", "nulo da o marcador");
ok(winAnsiSafe(undefined) === "-", "undefined da o marcador");
ok(winAnsiSafe("   ") === "-", "so espacos da o marcador");
ok(winAnsiSafe("", 60, "sem documento") === "sem documento", "o marcador e escolhido por quem chama");

console.log("\n== a tabela do CP1252, conferida ponta a ponta ==");
ok(ehWinAnsi("A") && ehWinAnsi("~") && ehWinAnsi(" "), "ASCII imprimivel");
ok(ehWinAnsi("á") && ehWinAnsi("ÿ") && ehWinAnsi(" "), "Latin-1 alto");
ok(ehWinAnsi("€") && ehWinAnsi("—") && ehWinAnsi("’"), "os especiais do 0x80-0x9F");
ok(!ehWinAnsi("ā") && !ehWinAnsi("日") && !ehWinAnsi(""), "e o que esta fora fica mesmo fora");

console.log(`\n${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
