/**
 * Árvore de permissões — testes.
 *
 * Roda com `npm test`, que compila lib/permissions.ts antes.
 *
 * O que dói se estiver errado não é a caixa marcada na tela; é o caminho que
 * NÃO foi mapeado. Um usuário sem "Compras" continua abrindo `/invoice/<id>`
 * pelo link que colaram no chat, e a tela abre inteira, com o valor e o
 * fornecedor. Por isso a maior parte do que está aqui é permForPath, e não
 * a marcação da árvore.
 *
 * O outro caso caro é o oposto: alguém trancado FORA por engano. Lista vazia,
 * resposta que não chegou, id de tela que não existe mais — em todos esses o
 * certo é liberar, porque acesso de menos num escritório para o trabalho, e
 * quem separa um escritório do outro é lib/access.ts, no servidor.
 */
const P = require("../.test-build/permissions.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

console.log("\n== a arvore em si ==");
{
  const ids = P.ALL_PERM_IDS;
  ok(ids.length === new Set(ids).size, "nenhum id repetido", ids.length + " ids");
  ok(P.PERM_TREE.every((g) => g.screens.length > 0), "nenhum grupo vazio");
  /*
   * Id de grupo repetido nao rebenta nada — e por isso que e perigoso.
   * `grantsGroup` faz `.find()` e para no primeiro, entao o segundo grupo com
   * o mesmo id fica invisivel: a permissao existe, a caixa aparece na arvore,
   * e o menu ignora o que ela diz. Aconteceu ao trazer o RH: o modulo `rh` do
   * menu de cliente e o grupo `rh` do menu geral colidiram.
   */
  const gids = P.PERM_TREE.map((g) => g.id);
  ok(gids.length === new Set(gids).size, "nenhum id de GRUPO repetido", gids);
  ok(P.PERM_TREE.every((g) => g.screens.every((s) => s.id.startsWith(g.id + "."))),
     "todo id de tela e prefixado pelo grupo");
  // Dois grupos vivem fora do workspace de cliente: as telas gerais e o RH,
  // que olha as 35 empresas de uma vez. Os outros seis sao modulos de dentro
  // de um cliente.
  ok(P.PERM_TREE.filter((g) => g.scope === "general").length === 2, "dois grupos fora do cliente",
     P.PERM_TREE.filter((g) => g.scope === "general").map((g) => g.id));
  // Seis desde que a Contabilidade saiu do Fiscal e virou modulo proprio.
  ok(P.PERM_TREE.filter((g) => g.scope === "client").length === 6, "e seis modulos de cliente",
     P.PERM_TREE.filter((g) => g.scope === "client").map((g) => g.id));
}

console.log("\n== sem restricao: null, undefined e lista vazia liberam ==");
for (const v of [null, undefined, []]) {
  ok(P.grantsScreen(v, "fiscal.vat"), "grantsScreen libera com " + JSON.stringify(v));
  ok(P.grantsGroup(v, "fiscal"), "grantsGroup libera com " + JSON.stringify(v));
  ok(P.grantsSeg(v, "fiscal", "vat"), "grantsSeg libera com " + JSON.stringify(v));
}

console.log("\n== com restricao ==");
{
  const only = ["compras.purchases", "fiscal.vat"];
  ok(P.grantsScreen(only, "compras.purchases"), "a tela listada passa");
  ok(!P.grantsScreen(only, "compras.analyze"), "tela do mesmo modulo, nao listada, e barrada");
  ok(!P.grantsScreen(only, "financeiro.bank"), "tela de outro modulo e barrada");

  ok(P.grantsGroup(only, "compras"), "o modulo aparece com UMA tela liberada");
  ok(!P.grantsGroup(only, "financeiro"), "modulo sem nenhuma tela liberada some");
  ok(!P.grantsGroup(only, "geral"), "o grupo geral tambem some quando esvaziado");

  // Tela que nao existe na arvore nao e restringivel: negar aqui trancaria o
  // usuario fora de qualquer tela nova antes de alguem ter dito nada sobre ela.
  ok(P.grantsScreen(only, "inventado.qualquer"), "id fora da arvore continua liberado");
}

console.log("\n== sanitizePermIds ==");
{
  ok(JSON.stringify(P.sanitizePermIds(["fiscal.vat", "nao.existe"])) === JSON.stringify(["fiscal.vat"]),
     "descarta id desconhecido", P.sanitizePermIds(["fiscal.vat", "nao.existe"]));
  ok(P.sanitizePermIds("nao e array").length === 0, "corpo que nao e array vira lista vazia");
  ok(P.sanitizePermIds([]).length === 0, "lista vazia continua vazia");
  const dup = P.sanitizePermIds(["fiscal.vat", "fiscal.vat"]);
  ok(dup.length === 1, "id repetido no corpo entra uma vez so", dup);
}

console.log("\n== RH: o modulo novo ==");
{
  ok(P.permForPath("/hr") === "rh.painel", "o painel do RH");
  ok(P.permForPath("/hr/weekly") === "rh.semanal", "o controlo semanal");
  ok(P.permForPath("/hr/companies") === "rh.empresas", "a lista de empresas");
  // A folha de UMA empresa e permissao a parte: quem ve que a empresa existe
  // nao ve, por isso, quanto cada pessoa dela ganha. E a ordem do teste no
  // permForPath importa — sem ela a lista engolia a folha.
  ok(P.permForPath("/hr/companies/abc-123") === "rh.folha", "a folha de uma empresa e outra permissao",
     P.permForPath("/hr/companies/abc-123"));
  ok(P.permForPath("/hr/submissions") === "rh.recebidas", "as horas recebidas");
  ok(P.permForPath("/hr/contacts") === "rh.comunicacao", "a comunicacao");

  const soSemanal = ["rh.semanal"];
  ok(P.grantsGroup(soSemanal, "rh"), "com uma tela liberada o modulo aparece");
  ok(!P.grantsScreen(soSemanal, "rh.folha"), "mas a folha continua fechada");
  ok(!P.grantsGroup(soSemanal, "geral"), "e o grupo geral desaparece por inteiro");
}

console.log("\n== permForPath: o caminho vira tela ==");
{
  const cases = [
    ["/", "geral.home"],
    ["/clients", "geral.clients"],
    ["/analyze", "geral.analyze"],
    ["/records", "geral.records"],
    ["/settings", "geral.settings"],
    ["/settings/users", "geral.users"],
    // A tela de permissoes e a MESMA chave da de usuarios: separa-las deixaria
    // dar a chave do cofre a quem nao pode ver quem existe.
    ["/settings/permissions", "geral.users"],
    ["/clients/abc-123/purchases", "compras.purchases"],
    ["/clients/abc-123/vat", "fiscal.vat"],
    ["/clients/abc-123/bank", "financeiro.bank"],
    ["/clients/abc-123/sales/some-sale-id", "vendas.sales"],
    // Revisao de nota chega por link colado, fora do menu. Sem esta linha a
    // permissao de Compras seria so um menu mais curto.
    ["/invoice/9f2b", "compras.purchases"],
    // Sempre liberados: o painel do cliente (senao abrir a empresa da tela
    // vazia), o painel do dono do sistema, e rota que nao existe.
    ["/clients/abc-123", null],
    ["/master", null],
    ["/rota/que/nao/existe", null],
  ];
  for (const [path, want] of cases) {
    const got = P.permForPath(path);
    ok(got === want, path + " -> " + want, got);
  }
  ok(P.permForPath("/clients/") === "geral.clients", "barra sobrando no fim nao muda a resposta");
  ok(P.permForPath("/settings/users/") === "geral.users", "barra sobrando em /settings/users");
}

console.log("\n== toda tela do menu de cliente esta na arvore ==");
{
  const M = require("../.test-build/modules.js");
  for (const m of M.MODULES) {
    for (const item of m.items) {
      const id = m.key + "." + item.seg;
      ok(P.ALL_PERM_IDS.includes(id), "modulo " + m.key + " -> " + item.seg + " tem permissao");
      ok(P.permForPath("/clients/x/" + item.seg) === id, "caminho de " + item.seg + " mapeia para " + id);
    }
  }
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail === 0 ? 0 : 1);
