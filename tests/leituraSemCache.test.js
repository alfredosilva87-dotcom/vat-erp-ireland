/**
 * As leituras do banco nao podem vir de cache — teste.
 *
 * O Next.js 14 GUARDA os `fetch` feitos no servidor, e o supabase-js usa `fetch`
 * por baixo. Numa rota com sessao isso nao se nota (ler o cookie ja a torna
 * dinamica); numa rota SEM cookies — como a fatura partilhada — o resultado fica
 * em cache e o banco deixa de ser consultado.
 *
 * Foi assim que apareceu: uma fatura ANULADA continuava a abrir pelo link
 * publico, e revogar o link tambem nao o fechava. O banco estava certo nos dois
 * casos; o que respondia era a cache.
 *
 * Num sistema contabil, uma leitura que nao ve a escrita que acabou de acontecer
 * e das falhas mais caras que ha: nao da erro, da um numero desactualizado com
 * ar de verdade. Este teste existe para a linha nao desaparecer numa limpeza.
 */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "lib", "supabase.ts"), "utf8");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

console.log("\n== o cliente do servidor desliga a cache do fetch ==");
{
  ok(/global:\s*\{/.test(src), "o createClient passa um `global`");
  ok(/fetch:\s*\(input,\s*init\)\s*=>/.test(src), "e substitui o fetch");
  ok(/cache:\s*"no-store"/.test(src), "com `cache: \"no-store\"`");

  // A substituicao tem de PRESERVAR o init original — cabecalhos, corpo, metodo.
  // Um `fetch(input, { cache: "no-store" })` sozinho deitava fora a chave de
  // servico e todo o pedido, e nada funcionaria (o que pelo menos se notaria).
  ok(/\{\s*\.\.\.init,\s*cache:\s*"no-store"\s*\}/.test(src),
     "espalhando o init original, para nao perder cabecalhos nem corpo");
}

console.log("\n== e fica no cliente, nao espalhado pelas rotas ==");
{
  // A regra vive num sitio so de proposito: uma regra que depende de alguem se
  // lembrar de a repetir na rota nova nao e uma regra.
  const dentroDoFactory = src.slice(src.indexOf("export function getServerSupabase"));
  ok(dentroDoFactory.includes('cache: "no-store"'),
     "a linha esta dentro de getServerSupabase");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
