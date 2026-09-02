/**
 * "Ha versao nova?" — teste da regra de comparacao.
 *
 * O ERP passa a ser privado no GitHub e corre NA MAQUINA DO ESCRITORIO.
 * Ninguem do lado de ca ve aquela instalacao: se ela ficar tres meses numa
 * versao com um erro de calculo ja corrigido, nao ha sintoma nenhum — o sistema
 * continua a responder, e a continuar errado.
 *
 * Duas armadilhas que este teste existe para travar:
 *
 *   Comparar como TEXTO. "1.9" > "1.10" e verdade em texto e mentira em
 *   versoes: o escritorio ficava preso na 1.9 para sempre, com o sistema a
 *   garantir-lhe que estava actualizado.
 *
 *   Avisar para BAIXO. Uma maquina a correr uma versao mais nova do que a
 *   publicada nao pode receber "ha actualizacao" — mandaria actualizar para
 *   tras.
 */
const {
  lerVersao, compararVersoes, maisAlta, compararComPublicada, escrever,
} = require("../.test-build/atualizacoesPuro");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

console.log("\n== ler a etiqueta ==");
{
  ok(escrever(lerVersao("v1.38")) === "1.38.0", "v1.38 (etiqueta do git, com o v)");
  ok(escrever(lerVersao("1.38.0")) === "1.38.0", "1.38.0 (package.json, sem o v)");
  ok(escrever(lerVersao("v1.31.1")) === "1.31.1", "com patch");
  ok(escrever(lerVersao(" v1.7 ")) === "1.7.0", "com espacos a volta");
  ok(lerVersao("demo") === null, "etiqueta que nao e versao");
  ok(lerVersao("backup-2026-08") === null, "etiqueta de backup");
  ok(lerVersao("") === null && lerVersao(null) === null && lerVersao(undefined) === null,
     "vazio, null e undefined");
  ok(lerVersao("v1") === null, "so o major nao chega");
}

console.log("\n== a armadilha do texto ==");
{
  // "1.9" > "1.10" em texto. Se isto passar, o escritorio fica preso na 1.9.
  ok(compararVersoes(lerVersao("1.9"), lerVersao("1.10")) === -1,
     "1.9 e ANTERIOR a 1.10 (em texto seria o contrario)");
  ok(compararComPublicada("1.9.0", "1.10.0").ha === true,
     "e por isso 1.9 -> 1.10 e novidade");
  ok(compararVersoes(lerVersao("1.2"), lerVersao("1.19")) === -1, "1.2 antes de 1.19");
  ok(compararVersoes(lerVersao("2.0"), lerVersao("10.0")) === -1, "2.0 antes de 10.0");
}

console.log("\n== a ordem entre versoes ==");
{
  ok(compararVersoes(lerVersao("1.38"), lerVersao("1.38.0")) === 0, "v1.38 e 1.38.0 sao a mesma");
  ok(compararVersoes(lerVersao("1.31.1"), lerVersao("1.31")) === 1, "1.31.1 e posterior a 1.31");
  ok(compararVersoes(lerVersao("2.0"), lerVersao("1.99")) === 1, "o major manda");
  ok(compararVersoes(lerVersao("1.38"), lerVersao("1.38")) === 0, "iguais");
}

console.log("\n== a mais alta de uma lista ==");
{
  // O GitHub devolve as etiquetas por ordem de CRIACAO, nao de versao: uma
  // v1.31.1 publicada depois da v1.35 (correccao numa linha antiga) vem
  // primeiro e passaria por "a mais recente".
  const doGitHub = ["v1.31.1", "v1.38", "v1.37", "v1.9", "v1.35"];
  ok(maisAlta(doGitHub).tag === "v1.38", "escolhe pela VERSAO e nao pela ordem que chegou",
     maisAlta(doGitHub));

  ok(maisAlta(["demo", "v1.2", "backup-x"]).tag === "v1.2", "ignora etiquetas que nao sao versao");
  ok(maisAlta(["demo", "backup-x"]) === null, "lista sem nenhuma versao");
  ok(maisAlta([]) === null, "lista vazia");
}

console.log("\n== quando ha, e quando NAO ha, novidade ==");
{
  const ha = compararComPublicada("1.38.0", "v1.39");
  ok(ha.ha === true, "publicada mais alta");
  ok(ha.instalada === "1.38.0" && ha.disponivel === "1.39.0", "e diz as duas", ha);

  ok(compararComPublicada("1.38.0", "v1.38").ha === false, "iguais nao e novidade");

  // Uma maquina a correr mais do que o publicado — o portatil dele a meio de
  // uma entrega. Avisar aqui mandava actualizar para tras.
  ok(compararComPublicada("1.39.0", "v1.38").ha === false, "instalada MAIS ALTA nao avisa");

  // Versao ilegivel e uma pergunta sem resposta, e responder "actualize" a uma
  // pergunta sem resposta faz o aviso aparecer sempre — e um aviso que aparece
  // sempre deixa de ser lido.
  ok(compararComPublicada(null, "v1.39").ha === false, "sem versao instalada, nao avisa");
  ok(compararComPublicada("1.38.0", null).ha === false, "sem versao publicada, nao avisa");
  ok(compararComPublicada("nao-e-versao", "v1.39").ha === false, "instalada ilegivel, nao avisa");
  ok(compararComPublicada("1.38.0", "main").ha === false, "publicada ilegivel, nao avisa");
}

console.log("\n== o tamanho do salto ==");
{
  // "no inicio vamos precisar atualizar muita coisa" — o salto e o que separa
  // "ha uma correccao" de "esta instalacao esta muito para tras".
  ok(compararComPublicada("1.30.0", "v1.38").saltoMinor === 8, "1.30 -> 1.38 sao 8 versoes",
     compararComPublicada("1.30.0", "v1.38").saltoMinor);
  ok(compararComPublicada("1.38.0", "v1.38.1").saltoMinor === 0, "correccao de patch nao e salto");
  // Entre majors a distancia em minors nao quer dizer nada.
  ok(compararComPublicada("1.38.0", "v2.1").saltoMinor === 0, "major diferente nao conta minors");
}

console.log("\n== a versao instalada bate com o package.json ==");
{
  // Sem isto as duas separam-se em silencio: o `package.json` fica em 0.1.0, a
  // etiqueta vai em v1.38, e a instalacao passa a achar-se eternamente
  // desactualizada — ou eternamente actualizada, que e pior.
  const pkg = require("../package.json");
  ok(lerVersao(pkg.version) !== null, `package.json.version ("${pkg.version}") e uma versao legivel`);

  const fs = require("fs"), path = require("path");
  const handoff = fs.readFileSync(path.join(__dirname, "..", "HANDOFF.md"), "utf8");
  // A MAIS ALTA, e nao a primeira linha: a tabela do HANDOFF nao esta ordenada
  // por versao — apanhei-a a devolver a v0.3, que e a entrada mais antiga.
  const todas = [...handoff.matchAll(/^\| (v\d+\.\d+(?:\.\d+)?)[ |]/gm)].map((m) => m[1]);
  const ultima = maisAlta(todas);
  ok(!!ultima, "o HANDOFF tem versoes na tabela", todas.length);
  ok(ultima && compararVersoes(lerVersao(pkg.version), ultima.versao) === 0,
     `package.json (${pkg.version}) bate com a ultima entrega do HANDOFF (${ultima && ultima.tag})`);
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
