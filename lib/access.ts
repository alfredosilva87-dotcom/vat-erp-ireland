import "server-only";
import { getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";

/**
 * Quem pode ver o quê, entre empresas.
 *
 * O sistema é multiempresa desde a v1.5 (`companies`, `app_users.company_id`,
 * "trocar de empresa" na barra lateral), mas o escopo por empresa só existia em
 * 7 das 68 rotas — as de cliente, usuário e empresa. Todo o resto exigia apenas
 * **sessão válida**: com o UUID de uma nota, qualquer usuário autenticado lia,
 * alterava e baixava o documento de outro escritório.
 *
 * Não havia rede de proteção no banco: as tabelas têm RLS ligado, mas o app
 * acessa com a chave de serviço, que ignora RLS por definição.
 *
 * Num self-host de um escritório só isso nunca se manifesta — todo usuário é da
 * mesma empresa. **Na cópia em nuvem, que atende mais de um escritório, é sigilo
 * fiscal de terceiro.** Este arquivo existe por causa dessa segunda.
 *
 * Três decisões que moldam o comportamento:
 *
 *   1. **Recusa é 404, não 403.** "Existe, mas não é seu" já conta que existe, e
 *      num escritório de contabilidade a existência de um cliente é informação.
 *   2. **Recurso sem empresa é liberado.** Linha criada antes do multiempresa
 *      tem `company_id` nulo; recusar trancaria o escritório fora dos próprios
 *      dados antigos.
 *   3. **Perfil `master` passa por tudo.** É o painel do dono do sistema, que
 *      administra as empresas — o escopo por empresa não se aplica a ele.
 */

const sb = () => getServerSupabase();

export type AccessOk = { companyId: string | null; role: string };
export type AccessResult = AccessOk | { error: Response };

const notFound = () =>
  ({ error: Response.json({ error: "Not found." }, { status: 404 }) });
const notSignedIn = () =>
  ({ error: Response.json({ error: "Not signed in." }, { status: 401 }) });

/**
 * O núcleo: compara a empresa da sessão com a do recurso.
 *
 * `resourceCompany === undefined` significa que o recurso não foi encontrado —
 * e a resposta é a mesma de recurso de outra empresa, de propósito.
 */
async function decide(resourceCompany: string | null | undefined): Promise<AccessResult> {
  const user = await getSessionUser();
  if (!user) return notSignedIn();
  if (user.role === "master") return { companyId: user.company_id, role: user.role };
  if (resourceCompany === undefined) return notFound();
  // Dado anterior ao multiempresa: liberado, senão o escritório perde o próprio
  // histórico.
  if (resourceCompany === null) return { companyId: user.company_id, role: user.role };
  if (!user.company_id || user.company_id !== resourceCompany) return notFound();
  return { companyId: user.company_id, role: user.role };
}

/** `undefined` quando não existe; `null` quando existe e não tem empresa. */
async function companyOfClient(clientId: string): Promise<string | null | undefined> {
  if (!clientId) return undefined;
  const { data } = await sb().from("clients").select("company_id").eq("id", clientId).maybeSingle();
  return data ? ((data as any).company_id ?? null) : undefined;
}

/** A empresa de um recurso que pertence a um cliente, em duas consultas. */
async function companyVia(
  table: string, id: string, clientColumn = "client_id"
): Promise<string | null | undefined> {
  if (!id) return undefined;
  const { data } = await sb().from(table).select(clientColumn).eq("id", id).maybeSingle();
  if (!data) return undefined;
  const clientId = (data as any)[clientColumn] as string | null;
  // Recurso sem cliente (nota lançada sem cliente, item de e-mail não roteado):
  // não há empresa a comparar, então cai na regra do dado sem empresa.
  if (!clientId) return null;
  return companyOfClient(clientId);
}

export const requireClient = async (clientId: string) => decide(await companyOfClient(clientId));
export const requireInvoice = async (invoiceId: string) => decide(await companyVia("invoices", invoiceId));
export const requireSale = async (saleId: string) => decide(await companyVia("sales", saleId));
export const requireObligation = async (id: string) => decide(await companyVia("obligations", id));
export const requireInboxItem = async (itemId: string) => decide(await companyVia("inbox_items", itemId));
export const requireBankAccount = async (accountId: string) => decide(await companyVia("bank_accounts", accountId));

/** Documento extra de nota: chega ao cliente pela nota (camada B3). */
export async function requireInvoiceDocument(docId: string): Promise<AccessResult> {
  if (!docId) return decide(undefined);
  const { data } = await sb()
    .from("invoice_documents").select("invoice_id").eq("id", docId).maybeSingle();
  if (!data) return decide(undefined);
  return requireInvoice((data as any).invoice_id as string);
}

/**
 * Para rota que recebe uma LISTA de ids (aprovar em lote, apagar em lote).
 *
 * Devolve só os ids da empresa de quem pediu, em vez de recusar o lote inteiro:
 * um lote com um id de outra empresa é quase sempre tela desatualizada, não
 * ataque — e recusar tudo faria o contador perder as 24 aprovações legítimas por
 * causa de uma linha velha. O que **não** pode é aprovar a de fora.
 */
export async function filterInvoicesByCompany(ids: string[]): Promise<string[] | { error: Response }> {
  const user = await getSessionUser();
  if (!user) return notSignedIn();
  if (user.role === "master" || !ids.length) return ids;

  const { data } = await sb().from("invoices").select("id,client_id").in("id", ids);
  const rows = (data ?? []) as { id: string; client_id: string | null }[];
  const clientIds = Array.from(new Set(rows.map((r) => r.client_id).filter(Boolean) as string[]));
  if (!clientIds.length) return rows.map((r) => r.id);

  const { data: clients } = await sb()
    .from("clients").select("id,company_id").in("id", clientIds);
  const allowed = new Set(
    ((clients ?? []) as { id: string; company_id: string | null }[])
      .filter((c) => c.company_id === null || c.company_id === user.company_id)
      .map((c) => c.id)
  );
  return rows.filter((r) => !r.client_id || allowed.has(r.client_id)).map((r) => r.id);
}

/**
 * Os ids de cliente que a sessão pode ver. `null` = pode ver tudo (perfil
 * `master`), e é diferente de `[]`, que é "não pode ver nenhum".
 *
 * Serve para as rotas de LISTA, que não recebem um id no caminho e por isso não
 * têm o que comparar: `GET /api/invoices` sem cliente devolvia todas as notas do
 * banco, de todos os escritórios.
 */
export async function visibleClientIds(): Promise<string[] | null | { error: Response }> {
  const user = await getSessionUser();
  if (!user) return notSignedIn();
  if (user.role === "master") return null;
  const { data } = await sb().from("clients").select("id,company_id");
  const rows = (data ?? []) as { id: string; company_id: string | null }[];
  return rows
    .filter((c) => c.company_id === null || c.company_id === user.company_id)
    .map((c) => c.id);
}

/**
 * A sessão pode ver item de e-mail que não foi roteado?
 *
 * Item não roteado não tem cliente, logo não tem empresa: alguém escreveu para o
 * endereço base, ou usou um token que não existe. Ele **precisa** aparecer,
 * porque é exatamente o que pede decisão do escritório — mas mostrá-lo a todos
 * os escritórios de uma instalação compartilhada entregaria remetente e assunto
 * do e-mail de um estranho para todo mundo.
 *
 * A caixa é configurada por instalação (variável de ambiente), então ela pertence
 * a UM escritório. Com uma empresa só na instalação — o caso do self-host — não
 * há ambiguidade e o item aparece. Com mais de uma, só o perfil `master`, que é
 * quem configurou a caixa, vê.
 */
export async function canSeeUnroutedMail(): Promise<boolean> {
  const user = await getSessionUser();
  if (!user) return false;
  if (user.role === "master") return true;
  const { count } = await sb().from("companies").select("*", { count: "exact", head: true });
  return (count ?? 1) <= 1;
}

/** Açúcar para o padrão `if ("error" in a) return a.error;` nas rotas. */
export const denied = (a: AccessResult): a is { error: Response } => "error" in a;
