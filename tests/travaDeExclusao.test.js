/**
 * CADASTRO COM MOVIMENTO NÃO SE APAGA — teste.
 *
 * O caso do meio é real e é a razão de a regra existir: ao limpar uma conta de
 * semeadura desta instalação, apagá-la teria FALHADO no razão (106 lançamentos,
 * `no action`) **depois** de já ter posto 47 movimentos de banco sem autor
 * (`set null`). Meio estrago feito, e um erro no fim.
 *
 * O que este teste guarda com mais cuidado é a fronteira: um cadastro LIMPO
 * continua a poder ser apagado. Uma trava que trava tudo transforma-se em lixo
 * acumulado, e alguém acaba por a contornar pelo banco.
 */
const {
  decidirExclusao, resumoDoImpedimento, podeSerEscolhido,
} = require("../.test-build/cadastros/travaDeExclusao");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

console.log("\n== o cadastro LIMPO continua a poder ser apagado ==");
ok(decidirExclusao([]).pode === true, "sem vinculos nenhuns");
ok(decidirExclusao([{ chave: "v.faturas", quantidade: 0 }]).pode === true,
  "vinculos todos a zero contam como limpo");
ok(decidirExclusao([
  { chave: "v.faturas", quantidade: 0 },
  { chave: "v.vendas", quantidade: 0 },
  { chave: "v.razao", quantidade: 0 },
]).pode === true, "tres tabelas, todas vazias: o cliente criado por engano sai");

console.log("\n== O CASO REAL: a conta de semeadura desta instalacao ==");
{
  const v = decidirExclusao([
    { chave: "v.razao", quantidade: 106 },
    { chave: "v.baixas", quantidade: 55 },
    { chave: "v.movimentosBanco", quantidade: 45 },
    { chave: "v.importacoesBanco", quantidade: 2 },
    { chave: "v.horasRh", quantidade: 0 },
  ]);
  ok(v.pode === false, "nao se apaga");
  ok(v.total === 208, "e diz o tamanho: 208 linhas dependem dela", v.total);
  ok(v.vinculos.length === 4, "o vinculo a zero nao entra na lista", v.vinculos.length);
  ok(v.vinculos[0].chave === "v.razao" && v.vinculos[0].quantidade === 106,
    "o maior vem primeiro — e a ordem em que a informacao serve", v.vinculos[0]);
}

console.log("\n== UM vinculo chega: nao ha limiar ==");
ok(decidirExclusao([{ chave: "v.faturas", quantidade: 1 }]).pode === false,
  "uma fatura sozinha ja trava — porque e essa fatura que ficaria orfa");

console.log("\n== o resumo nao despeja onze linhas em cima de ninguem ==");
{
  const v = decidirExclusao([
    { chave: "a", quantidade: 10 }, { chave: "b", quantidade: 9 },
    { chave: "c", quantidade: 8 }, { chave: "d", quantidade: 7 },
    { chave: "e", quantidade: 6 },
  ]);
  const r = resumoDoImpedimento(v);
  ok(r.principais.length === 3, "mostra tres", r.principais.length);
  ok(r.restantes === 2, "e diz que ha mais dois", r.restantes);
  ok(r.total === 40, "mas o total conta TODOS, nao so os mostrados", r.total);
  ok(resumoDoImpedimento(v, 5).restantes === 0, "quem quiser os cinco pede cinco");
}
ok(resumoDoImpedimento({ pode: true }) === null, "cadastro limpo nao tem resumo nenhum");

console.log("\n== do outro lado: o desactivado nao serve para trabalho NOVO ==");
{
  const activo = { activo: true }, morto = { activo: false };
  ok(podeSerEscolhido(activo).ok === true, "activo escolhe-se");
  ok(podeSerEscolhido(morto).ok === false, "desactivado nao se escolhe de novo");
  ok(podeSerEscolhido(morto).aviso === "desactivado", "e o ecra sabe porque nao");
}

console.log("\n== mas nao se expulsa ninguem do meio do trabalho ==");
{
  // Alguem escolheu o cliente, e enquanto preenchia o formulario outra pessoa
  // desactivou-o. Fechar-lhe a porta agora perdia o que ja tinha escrito.
  const r = podeSerEscolhido({ activo: false }, true);
  ok(r.ok === true, "quem JA o tinha escolhido continua", r);
  ok(r.aviso === "desactivado", "mas e avisado de que aquilo esta desactivado", r);
}

console.log(`\n${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
