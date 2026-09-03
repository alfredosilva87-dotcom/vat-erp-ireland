/**
 * Toda rota que recebe um recurso no caminho confere a empresa? — teste.
 *
 * Este teste nao exercita codigo: le os arquivos de rota e confere que cada
 * handler exportado chama um guarda de `lib/access.ts`.
 *
 * Existe porque o conserto de hoje foi editar ~50 arquivos, e a proxima rota que
 * alguem criar vai esquecer. Autorizacao que depende de lembrar tem buraco, e o
 * buraco nao aparece em teste de tela — a rota funciona perfeitamente, so
 * funciona para quem nao devia. Aqui o esquecimento quebra o `npm test`.
 */
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const API = path.join(__dirname, "..", "app", "api");

function routeFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...routeFiles(p));
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

const rel = (p) => p.slice(p.indexOf("app/api")).replace(/\\/g, "/");

/**
 * Rotas que NAO precisam do guarda, e o motivo de cada uma. Lista fechada de
 * proposito: acrescentar uma exige escrever aqui por que ela e segura, e essa
 * frase e o que uma revisao futura vai ler.
 */
const EXEMPT = {
  "app/api/auth/login/route.ts": "publica por definicao",
  "app/api/auth/logout/route.ts": "encerra a propria sessao",
  "app/api/auth/me/route.ts": "devolve a propria sessao",
  "app/api/profile/route.ts":
    "a propria conta: a rota nunca le um id do pedido, escreve sempre em " +
    "getSessionUser().id. Nao toca em role, active nem screen_access — quem muda " +
    "isso e um administrador, na tela de utilizadores.",
  "app/api/auth/forgot-password/route.ts": "publica, fluxo de recuperacao",
  "app/api/auth/reset-password/route.ts": "publica, fluxo de recuperacao",
  "app/api/updates/route.ts":
    "pergunta se ha versao nova. Nao le nem escreve dado de cliente nenhum: " +
    "fala com o GitHub e compara duas versoes. Nao recebe id no pedido, entao " +
    "nao ha empresa que guardar — e `requireRole('user')` ja exige sessao.",
  "app/api/hr/tax-tables/route.ts":
    "tabelas fiscais (PAYE/USC/PRSI): a lei irlandesa e a mesma para os 35 " +
    "clientes do escritorio, entao e referencia global como a base de aliquotas. " +
    "Gravar exige `requireRole('admin')`.",
  "app/api/revenue/credential/route.ts":
    "o certificado do ROS e do ESCRITORIO, nao de um cliente: e com ele que o " +
    "escritorio fala a Revenue em nome dos 35, usando o TAIN de agente. A rota " +
    "nunca le um id de cliente do pedido — trabalha sempre em " +
    "getSessionUser().company_id, e escrever exige `requireRole('admin')`.",
  "app/api/revenue/test/route.ts":
    "testar a ligacao usa a credencial da PROPRIA empresa (company_id da sessao) " +
    "e faz uma leitura pura de RPN. O numero de empregador vem no pedido de " +
    "proposito — e o proprio ensaio, feito por um administrador, e nao devolve " +
    "dado fiscal nenhum: so a contagem.",
  "app/api/base/route.ts": "tabela de aliquotas: referencia global, igual para todos",
  "app/api/base/category/route.ts": "tabela de aliquotas: referencia global",
  "app/api/credit-rules/route.ts": "regras de credito por tipo de negocio: referencia global",
  "app/api/credit-rules/[id]/route.ts": "referencia global",
  "app/api/items/route.ts": "items_master e catalogo global de itens, sem dado de cliente",
  "app/api/search/route.ts":
    "rota de LISTA: usa visibleClientIds para escolher os clientes e filtra notas e " +
    "vendas pelos mesmos ids. Alem disso confere a arvore de permissoes por categoria — " +
    "quem nao pode abrir a tela de clientes nao recebe clientes no resultado, porque a " +
    "linha ja contaria que a empresa existe.",
  "app/api/items/[id]/route.ts": "catalogo global",
  "app/api/clients/route.ts": "ja filtra por company_id na propria rota",
  "app/api/companies/route.ts": "painel do dono do sistema, exige perfil master (conferido: requireRole)",
  "app/api/companies/[id]/history/route.ts": "painel do dono, exige master (conferido: requireRole)",
  "app/api/companies/[id]/route.ts": "painel do dono do sistema, exige perfil master",
  "app/api/companies/[id]/activate/route.ts": "painel do dono, exige master",
  "app/api/phone/keepalive/route.ts":
    "cron que impede a passagem de adormecer. Nao ha id de cliente no caminho e " +
    "nao le dado de cliente nenhum: devolve so contagens do banco da PASSAGEM " +
    "(links ativos, uploads pendentes). Protegida por CRON_SECRET quando definido; " +
    "sem segredo continua a funcionar, porque uma variavel esquecida nao pode " +
    "derrubar o link de telefone dos clientes.",
  "app/api/charge-types/route.ts":
    "tipos de encargo do ESCRITORIO (juros, taxa, multa, desconto) e a conta de " +
    "cada um em cada lado. Referencia global, como o plano de contas: nao ha id " +
    "de cliente no caminho. Leitura exige sessao; mexer exige admin, porque mudar " +
    "a conta de 'juros' muda para onde vai o resultado de todos os clientes.",
  "app/api/chart/route.ts":
    "plano de contas do ESCRITORIO: referencia global, igual para os 35 clientes, " +
    "como a base de aliquotas e o catalogo de itens. Nao ha id de cliente no " +
    "caminho porque nao ha cliente a guardar. Leitura exige sessao (requireRole " +
    "user); criar e alterar exigem admin.",
  "app/api/master/licenses/route.ts":
    "cofre de quem VENDE, nao recurso de empresa nenhuma: exige perfil master " +
    "(conferido: requireRole) e, sem a chave privada no disco, responde 404. " +
    "Nao ha id de cliente no caminho para conferir.",
  "app/api/companies/[id]/letterhead/route.ts":
    "dados do escritorio no timbre das demonstracoes: exige perfil admin E confere " +
    "guard.user.company_id === params.id nos DOIS handlers, entao um admin nunca le " +
    "nem escreve o timbre de outro escritorio. Nao usa requireClient porque o recurso " +
    "e a empresa, e nao um cliente dela.",
  "app/api/companies/contacts.sage.csv/route.ts": "ja filtra por company_id",
  "app/api/users/route.ts": "ja filtra por company_id",
  "app/api/users/[id]/route.ts": "exige perfil admin e filtra por empresa",
  "app/api/mail/fetch/route.ts": "busca a caixa do proprio escritorio; o roteamento e por token de cliente",
  "app/api/phone/manifest/[token]/route.ts":
    "PUBLICA por desenho: o manifesto do PWA de um link de telefone (camada B4). So devolve " +
    "nome e start_url para o icone da tela inicial abrir a captura certa, nunca dado de empresa.",
  "app/api/phone/fetch/route.ts":
    "busca a passagem na nuvem do proprio escritorio; o roteamento e por token de cliente, " +
    "igual a busca de e-mail",
  "app/api/phone/upload/route.ts":
    "PUBLICA por desenho (camada B4): quem envia e cliente do escritorio e nao tem sessao. " +
    "O token do link e a credencial, e o guarda de empresa nao se aplica porque a rota roda na " +
    "passagem na nuvem, que nao tem a tabela de empresas. Ela SO ESCREVE: valida o link, recusa " +
    "por forma, prazo, tipo, tamanho e teto de envios, e nao devolve nada do que ja esta la.",
  "app/api/invoice-share/[token]/route.ts":
    "PUBLICA por desenho: quem recebe a fatura e o cliente do NOSSO cliente — nao tem conta no ERP, " +
    "nao vai criar uma, e o WhatsApp nao aceita anexo por link. Sem esta rota o envio por WhatsApp " +
    "nao existe. O token sao 32 bytes aleatorios que so nascem quando alguem escolhe partilhar " +
    "AQUELA fatura; serve uma fatura so, nunca o cliente; rascunho nao gera token; anular a fatura " +
    "fecha o link; e revoga-se a mao. So LE, e responde 404 igual para token invalido, fatura " +
    "anulada e link revogado — mensagens diferentes diriam a quem experimenta tokens qual chegou " +
    "a existir.",
  "app/api/obligations/vat-threshold/route.ts":
    "rota de LISTA, irma da agenda: usa visibleClientIds para escolher os clientes e so " +
    "varre as vendas desses ids. Nao recebe cliente no caminho porque a pergunta e 'qual " +
    "deles esta a passar o limiar' — e o cliente que interessa e justamente aquele em que " +
    "ninguem estava a pensar.",
  "app/api/obligations/agenda/route.ts":
    "rota de LISTA de todos os clientes: usa visibleClientIds para escolher quais, e " +
    "so le obligations/recurring_obligations desses ids. Nao ha um cliente a guardar " +
    "porque a pergunta da tela e justamente 'em qual deles tenho de mexer'.",
  "app/api/mail/inbox/route.ts": "rota de lista: usa visibleClientIds",
  "app/api/hr/companies/route.ts":
    "rota de LISTA do modulo RH: nao recebe id no caminho, entao o escopo vem de " +
    "visibleClientIds — o mesmo contrato das outras listas. Devolve so as empresas " +
    "cujo cliente a sessao pode ver; sem isso a folha de um escritorio apareceria noutro.",
  "app/api/hr/submissions/route.ts":
    "rota de LISTA: mesma regra. A fila e filtrada por visibleClientIds, e lista vazia " +
    "vira um id impossivel no `in` — quem nao pode ver cliente nenhum recebe fila vazia, " +
    "nao a fila inteira.",
  "app/api/invoices/route.ts": "lista usa visibleClientIds; POST confere o cliente do payload",
  "app/api/invoices/approve/route.ts": "recebe lista de ids: usa filterInvoicesByCompany",
  "app/api/invoices/bulk-delete/route.ts": "recebe lista de ids: usa filterInvoicesByCompany",
  "app/api/extract/route.ts": "confere o cliente quando ele vem no formulario",
};

const GUARDS = [
  "requireClient", "requireInvoice", "requireSale", "requireObligation",
  "requireRecurringObligation",
  "requireInboxItem", "requireBankAccount", "requireInvoiceDocument",
  "filterInvoicesByCompany", "visibleClientIds",
];

const HANDLER = /export async function (GET|POST|PATCH|PUT|DELETE)\b/g;

console.log("\n== toda rota com recurso no caminho confere a empresa ==");

const files = routeFiles(API);
ok(files.length > 50, `${files.length} rotas encontradas`, files.length);

const missing = [];
for (const f of files) {
  const name = rel(f);
  const src = fs.readFileSync(f, "utf8");
  const handlers = (src.match(HANDLER) || []).length;
  if (!handlers) continue;

  const guarded = GUARDS.some((g) => src.includes(g));
  if (guarded) continue;
  if (EXEMPT[name]) continue;
  missing.push(name);
}

ok(missing.length === 0,
  "nenhuma rota sem guarda de empresa nem justificativa em EXEMPT",
  missing);

console.log("\n== o guarda e chamado em TODO handler do arquivo, nao so no primeiro ==");
const partial = [];
for (const f of files) {
  const name = rel(f);
  if (EXEMPT[name]) continue;
  const src = fs.readFileSync(f, "utf8");
  const handlers = (src.match(HANDLER) || []).length;
  if (!handlers) continue;
  if (!GUARDS.some((g) => src.includes(g))) continue;
  // Um `if (denied(...)) return` por handler. Menos que isso quer dizer que um
  // handler ficou aberto — o caso mais facil de deixar passar, porque a rota
  // parece protegida.
  const checks = (src.match(/denied\(/g) || []).length;
  if (checks < handlers) partial.push({ rota: name, handlers, checks });
}
ok(partial.length === 0, "nenhum arquivo com handler destravado", partial);

console.log("\n== a lista de dispensados nao tem entrada morta ==");
const stale = Object.keys(EXEMPT).filter((k) => !files.some((f) => rel(f) === k));
ok(stale.length === 0, "toda rota dispensada ainda existe", stale);

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========`);
process.exit(fail ? 1 : 0);
