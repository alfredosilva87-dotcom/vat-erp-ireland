import { NextRequest, NextResponse } from "next/server";
import { visibleClientIds } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { grantsScreen } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A busca da barra do topo.
 *
 * Procura o que a pessoa escreveria de cabeça: o nome de um fornecedor, o
 * número de uma nota, o nome de um cliente, a descrição de um item. Não é
 * busca de texto completo — é `ilike` em poucas colunas escolhidas, que é o que
 * responde à pergunta real ("cadê aquela nota da Musgrave?") sem exigir índice
 * novo nem extensão do Postgres.
 *
 * Dois limites que valem a leitura:
 *
 * 1. **O escopo é o de sempre.** `visibleClientIds()` decide que clientes
 *    entram, e as notas e vendas são filtradas pelos mesmos ids. Sem isso a
 *    busca seria a porta dos fundos do sigilo entre escritórios: bastava
 *    escrever o nome de uma empresa de outro contador.
 *
 * 2. **Respeita a árvore de permissões.** Quem não pode abrir a tela de
 *    clientes não recebe clientes nos resultados. Devolver a linha e barrar só
 *    no clique seria pior do que não buscar: o resultado já conta que a empresa
 *    existe, e num escritório a existência de um cliente é informação.
 */

const LIMITE = 8; // por categoria — o suficiente para reconhecer, não para navegar

/** Escapa o que o `ilike` do PostgREST trata como curinga ou separador. */
const limpar = (q: string) => q.replace(/[%,()]/g, " ").trim();

export async function GET(req: NextRequest) {
  const q = limpar(new URL(req.url).searchParams.get("q") || "");
  if (q.length < 2) return NextResponse.json({ q, groups: [] });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const allowed = await visibleClientIds();
  if (allowed !== null && !Array.isArray(allowed)) return allowed.error;

  const sb = getServerSupabase();
  const like = `%${q}%`;
  // Lista vazia recusaria o filtro `in`; um id impossível devolve zero linhas,
  // que é o certo para quem não pode ver cliente nenhum.
  const ids = allowed?.length ? allowed : allowed ? ["00000000-0000-0000-0000-000000000000"] : null;

  const master = user.role === "master";
  const pode = async (perm: string) => {
    if (master) return true;
    const { data } = await sb.from("app_users").select("screen_access").eq("id", user.id).maybeSingle();
    return grantsScreen((data as any)?.screen_access ?? null, perm);
  };
  const [podeClientes, podeCompras, podeVendas, podeItens] = await Promise.all([
    pode("geral.clients"), pode("compras.purchases"), pode("vendas.sales"), pode("geral.items"),
  ]);

  const groups: { key: string; rows: any[] }[] = [];

  if (podeClientes) {
    let cq = sb.from("clients")
      .select("id,client_code,name,vat_number,contact_person,status")
      .or(`name.ilike.${like},client_code.ilike.${like},vat_number.ilike.${like},contact_person.ilike.${like}`)
      .limit(LIMITE);
    if (ids) cq = cq.in("id", ids);
    const { data } = await cq;
    if (data?.length) groups.push({ key: "clients", rows: data });
  }

  if (podeCompras) {
    let iq = sb.from("invoices")
      .select("id,client_id,client_name,supplier_name,store_name,invoice_number,invoice_date,total_gross,document_path")
      .or(`supplier_name.ilike.${like},store_name.ilike.${like},invoice_number.ilike.${like},original_filename.ilike.${like}`)
      .order("invoice_date", { ascending: false, nullsFirst: false })
      .limit(LIMITE);
    if (ids) iq = iq.in("client_id", ids);
    const { data } = await iq;
    if (data?.length) groups.push({ key: "invoices", rows: data });
  }

  if (podeVendas) {
    let sq = sb.from("sales")
      .select("id,client_id,customer,doc_number,entry_date,net_amount,vat_amount")
      .or(`customer.ilike.${like},doc_number.ilike.${like}`)
      .order("entry_date", { ascending: false, nullsFirst: false })
      .limit(LIMITE);
    if (ids) sq = sq.in("client_id", ids);
    const { data } = await sq;
    if (data?.length) groups.push({ key: "sales", rows: data });
  }

  if (podeItens) {
    // O catálogo de itens é global — não pertence a cliente nenhum, por isso
    // não leva filtro de empresa.
    const { data } = await sb.from("items_master")
      .select("id,canonical_name,category_name,expected_vat_rate,occurrences")
      .ilike("canonical_name", like)
      .order("occurrences", { ascending: false })
      .limit(LIMITE);
    if (data?.length) groups.push({ key: "items", rows: data });
  }

  return NextResponse.json({ q, groups });
}
