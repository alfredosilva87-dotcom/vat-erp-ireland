import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getServerSupabase } from "@/lib/supabase";
import { conciliarControlo } from "@/lib/financial/control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Contas a pagar e a receber — a lista.
 *
 * Os títulos já existiam (nascem do documento, ver `lib/financial/titles.ts`);
 * o que não existia era onde vê-los.
 *
 * ---------------------------------------------------------------------------
 * A LISTA É LIMITADA POR DESENHO
 *
 * O padrão é "o que está em aberto", e não "tudo". Um cliente com três anos de
 * movimento tem milhares de títulos, e a esmagadora maioria já foi paga — pôr
 * tudo no ecrã é lento e, pior, esconde os 60 que interessam no meio dos 3.000
 * que não. Quem quiser o histórico pede por data.
 *
 * `total` volta sempre, mesmo quando a página traz 50: sem ele a pessoa não
 * sabe se está a ver o fim da lista ou o começo, e uma soma que não fecha com
 * o que se vê na tela faz duvidar do sistema inteiro.
 * ---------------------------------------------------------------------------
 */

const PAGINA_MAX = 100;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind") === "receivable" ? "receivable" : "payable";
  const status = sp.get("status") || "pendentes";
  const de = sp.get("from");
  const ate = sp.get("to");
  const busca = (sp.get("q") || "").trim();
  const pagina = Math.max(0, Number(sp.get("page")) || 0);
  const tamanho = Math.min(PAGINA_MAX, Math.max(10, Number(sp.get("size")) || 50));

  const sb = getServerSupabase();
  const base = () => {
    let q = sb.from("ledger_items_open").select("*", { count: "exact" })
      .eq("client_id", params.id).eq("kind", kind);
    // "pendentes" agrupa aberto + parcial + vencido: é o que alguém abre a tela
    // para ver. Os estados soltos ficam disponíveis para quem quer olhar um só.
    if (status === "pendentes") q = q.neq("status", "settled");
    else if (status !== "todos") q = q.eq("status", status);
    if (de) q = q.gte("due_date", de);
    if (ate) q = q.lte("due_date", ate);
    if (busca) q = q.or(`counterparty.ilike.%${busca}%,document_ref.ilike.%${busca}%`);
    return q;
  };

  const { data, count, error } = await base()
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("issue_date", { ascending: true })
    .range(pagina * tamanho, pagina * tamanho + tamanho - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  /*
   * Os totais somam o FILTRO INTEIRO, não a página.
   *
   * Um rodapé que soma só as 50 linhas visíveis responde a uma pergunta que
   * ninguém fez, e parece responder à que toda a gente faz: "quanto devo?".
   */
  const { data: todas } = await base().limit(20000);
  const linhas = (todas ?? []) as any[];
  const soma = (f: (l: any) => number) =>
    Math.round(linhas.reduce((s, l) => s + (Number(f(l)) || 0), 0) * 100) / 100;

  /*
   * A conciliação da conta de controlo vem SEMPRE, e não atrás de um filtro.
   *
   * Ela compara o razão INTEIRO com o aging INTEIRO — não com o que o filtro
   * mostra. Fazê-la seguir o filtro daria uma diferença nova a cada clique,
   * e uma diferença que muda sozinha ensina a ignorá-la.
   */
  const control = await conciliarControlo(params.id, kind);

  return NextResponse.json({
    kind, status, page: pagina, size: tamanho, control,
    total: count ?? linhas.length,
    items: data ?? [],
    totals: {
      original: soma((l) => l.original_amount),
      charges: soma((l) => l.charges_amount),
      settled: soma((l) => l.settled_amount),
      outstanding: soma((l) => l.outstanding_amount),
      overdue: Math.round(linhas.filter((l) => l.status === "overdue")
        .reduce((s, l) => s + (Number(l.outstanding_amount) || 0), 0) * 100) / 100,
    },
  });
}
