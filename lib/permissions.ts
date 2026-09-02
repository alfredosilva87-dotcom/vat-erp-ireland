// A árvore de permissões: o que cada usuário enxerga do sistema.
//
// A folha é a TELA, não o módulo. Um módulo aparece quando pelo menos uma tela
// dele foi liberada — quer dizer, o pai é derivado dos filhos e não existe
// sozinho no banco. É o que permite o recorte que o escritório realmente faz:
// o estagiário lança compras mas não abre a leitura de documentos, o auxiliar
// fiscal vê apuração mas não vê banco.
//
// O que NÃO está aqui, de propósito:
//
//   - Ação (criar/editar/apagar). Grão de ação multiplica a árvore por quatro e
//     ninguém preenche. Se um dia precisar, entra como terceiro nível.
//   - O painel `master`, que é do dono do sistema e não do escritório.
//   - O painel do cliente (`dashboard`), que é a home de dentro da empresa:
//     esconder isso deixaria o usuário numa tela em branco ao abrir um cliente.
//
// Nada aqui substitui lib/access.ts. Aquilo é sigilo entre ESCRITÓRIOS e vive
// no servidor, em toda rota. Isto é divisão de trabalho DENTRO de um escritório
// e vive na navegação — ver enforcement em components/AccessGuard.tsx.
import type { TKey } from "./i18n/en";
import { MODULES, type ModuleKey } from "./modules";

/** Uma tela. `href` para as telas gerais, `seg` para as de dentro do cliente. */
export type PermScreen = { id: string; labelKey: TKey; href?: string; seg?: string };
export type PermGroup = {
  id: string;
  labelKey: TKey;
  /** `client` = telas que só existem dentro de uma empresa. */
  scope: "general" | "client";
  screens: PermScreen[];
};

/** As telas de fora do workspace de cliente. A ordem é a do menu geral. */
const GENERAL: PermScreen[] = [
  { id: "geral.home", labelKey: "nav.dashboard", href: "/" },
  { id: "geral.clients", labelKey: "nav.clients", href: "/clients" },
  { id: "geral.analyze", labelKey: "nav.analyze", href: "/analyze" },
  { id: "geral.inbox", labelKey: "nav.inbox", href: "/inbox" },
  { id: "geral.records", labelKey: "nav.database", href: "/records" },
  { id: "geral.items", labelKey: "nav.items", href: "/items" },
  { id: "geral.base", labelKey: "nav.rateBase", href: "/base" },
  // O plano de contas é referência GLOBAL, como a base de alíquotas e o
  // catálogo de itens: é o mesmo para os 35 clientes. Ver app/chart/page.tsx.
  { id: "geral.chart", labelKey: "nav.chart", href: "/chart" },
  // Os tipos de encargo do título e a conta de cada um — referência global,
  // como o plano. Ver app/charges/page.tsx.
  { id: "geral.charges", labelKey: "nav.charges", href: "/charges" },
  { id: "geral.obligations", labelKey: "nav.obligations", href: "/obligations" },
  { id: "geral.settings", labelKey: "nav.settings", href: "/settings" },
  { id: "geral.users", labelKey: "users.title", href: "/settings/users" },
];

/**
 * O módulo RH — a folha de pagamento, trazida do Payroll Control do Matheus.
 *
 * Vive no menu GERAL e não no de dentro do cliente, porque as telas dele olham
 * as 35 empresas de uma vez: o painel, o controlo semanal e a comunicação não
 * são de uma empresa, são do escritório. Só a folha (`rh.folha`) é de uma
 * empresa por vez, e chega-se a ela pela lista.
 *
 * A separação entre `rh.semanal` e `rh.folha` é a que o escritório
 * efetivamente usa: dá para pôr alguém a fechar o controlo semanal — que é
 * despachar payslips e marcar caixas — sem lhe entregar salário, taxa horária
 * e contrato de toda a gente.
 */
export const HR_SCREENS: PermScreen[] = [
  { id: "rh.painel", labelKey: "hr.navDashboard", href: "/hr" },
  { id: "rh.semanal", labelKey: "hr.navWeekly", href: "/hr/weekly" },
  { id: "rh.empresas", labelKey: "hr.navCompanies", href: "/hr/companies" },
  { id: "rh.folha", labelKey: "hr.navPayroll", href: "/hr/companies/:id" },
  { id: "rh.recebidas", labelKey: "hr.navSubmissions", href: "/hr/submissions" },
  { id: "rh.comunicacao", labelKey: "hr.navContacts", href: "/hr/contacts" },
  // As tabelas fiscais sao referencia GLOBAL — a lei irlandesa e a mesma para
  // os 35 clientes. Por isso vivem no menu geral do RH, e nao dentro de um
  // cliente: edita-las de dentro de um deles mentia sobre o alcance.
  { id: "rh.tabelas", labelKey: "hr.navTaxTables", href: "/hr/tax-tables" },
];

export const PERM_TREE: PermGroup[] = [
  { id: "geral", labelKey: "perm.groupGeneral", scope: "general", screens: GENERAL },
  { id: "rh", labelKey: "hr.title", scope: "general", screens: HR_SCREENS },
  ...MODULES.map((m): PermGroup => ({
    id: m.key,
    labelKey: m.labelKey,
    scope: "client",
    screens: m.items.map((i) => ({ id: `${m.key}.${i.seg}`, labelKey: i.key, seg: i.seg })),
  })),
];

export const ALL_PERM_IDS: string[] = PERM_TREE.flatMap((g) => g.screens.map((s) => s.id));
const KNOWN = new Set(ALL_PERM_IDS);

/** Descarta id que não existe mais (módulo renomeado, tela removida). */
export function sanitizePermIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ALL_PERM_IDS.filter((id) => ids.includes(id));
}

/**
 * `null`/`undefined` = acesso total. É o valor de toda linha que nunca passou
 * pela tela de permissões, então o sistema funciona igual para quem nunca
 * mexeu nisso — e é também o que a lista vazia significa depois de sanitizada,
 * porque gravar "nenhuma tela" seria criar um usuário que não pode fazer nada
 * sem ninguém ter pedido isso.
 */
export function grantsScreen(access: string[] | null | undefined, id: string): boolean {
  if (!access || !access.length) return true;
  if (!KNOWN.has(id)) return true; // tela fora da árvore não é restringível
  return access.includes(id);
}

/** Um módulo/grupo aparece se sobrou pelo menos uma tela dele. */
export function grantsGroup(access: string[] | null | undefined, groupId: string): boolean {
  if (!access || !access.length) return true;
  const g = PERM_TREE.find((x) => x.id === groupId);
  if (!g) return true;
  return g.screens.some((s) => access.includes(s.id));
}

/** Atalho para o menu de dentro do cliente, que conhece o segmento e o módulo. */
export function grantsSeg(
  access: string[] | null | undefined, moduleKey: ModuleKey, seg: string
): boolean {
  return grantsScreen(access, `${moduleKey}.${seg}`);
}

/**
 * A tela que um caminho representa, ou `null` quando o caminho não é
 * restringível (login, painel do cliente, painel master, rota desconhecida).
 *
 * Casos que valem a leitura:
 *
 *   - `/clients/<id>` sem mais nada é o painel do cliente: sempre liberado,
 *     senão abrir uma empresa dá tela vazia.
 *   - `/settings/permissions` é a MESMA permissão de `/settings/users`. São a
 *     administração de gente; separá-las permitiria dar a chave a quem não pode
 *     ver quem existe.
 *   - `/invoice/<id>` é a revisão de uma nota de compra, então pertence a
 *     Compras. Sem esta linha ficava o buraco de sempre: o menu esconde
 *     "Compras" e o usuário chega na nota pela busca ou por um link colado.
 */
export function permForPath(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, "") || "/";

  const client = p.match(/^\/clients\/([^/]+)(?:\/([^/]+))?/);
  if (client) {
    const seg = client[2];
    if (!seg) return null; // painel do cliente
    const mod = MODULES.find((m) => m.items.some((i) => i.seg === seg));
    return mod ? `${mod.key}.${seg}` : null;
  }

  if (p === "/settings/users" || p === "/settings/permissions") return "geral.users";
  if (p.startsWith("/invoice/")) return "compras.purchases";

  /*
   * A folha de UMA empresa é permissão à parte da lista de empresas: quem pode
   * ver que a empresa existe não vê, por isso, quanto cada pessoa dela ganha.
   * A ordem importa — `/hr/companies/<id>` tem de ser testado antes do prefixo
   * `/hr/companies`, senão a lista engolia a folha.
   */
  if (/^\/hr\/companies\/[^/]+/.test(p)) return "rh.folha";
  const hr = HR_SCREENS.find((sc) => sc.href === p);
  if (hr) return hr.id;

  const general = GENERAL.find((s) => s.href === p);
  return general ? general.id : null;
}
