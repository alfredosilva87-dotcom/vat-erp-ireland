import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { referencia } from "./tituloDeImposto";

/**
 * A OBRIGAÇÃO FOI PAGA? — a outra metade da pergunta.
 *
 * ---------------------------------------------------------------------------
 * ENTREGAR E PAGAR SÃO DOIS FACTOS, E O SISTEMA SÓ GUARDAVA UM
 *
 * A tela de obrigações tinha "Mark filed", e isso responde a **entreguei a
 * declaração?**. Não responde a **paguei o que ela apurou?** — e são coisas
 * diferentes, com consequências diferentes: a Revenue cobra juros pelo atraso
 * no pagamento mesmo com a declaração entregue a horas, e cobra coima pela
 * declaração em falta mesmo com o imposto pago.
 *
 * Alguém que olhasse aquela tela e visse tudo verde podia ter metade das contas
 * por pagar sem nada que o dissesse.
 *
 * ---------------------------------------------------------------------------
 * A LIGAÇÃO É A REFERÊNCIA, E NÃO UMA COLUNA NOVA
 *
 * O título de imposto nasce com `document_ref = "VAT3 Jan–Feb 2026"` — o nome
 * da própria obrigação, gerado por `referencia()`. Reutilizar essa mesma função
 * aqui é o que garante que os dois lados falam do mesmo texto: se ela mudar,
 * mudam os dois juntos.
 *
 * Uma coluna `ledger_item_id` em `obligations` seria mais firme, mas obrigava a
 * manter a ligação em dois sítios e a tratar do caso em que o título é apagado.
 * A referência é frouxa de propósito: não achar título nenhum é uma resposta
 * legítima — quer dizer "ainda não foi lançado em contas a pagar".
 * ---------------------------------------------------------------------------
 */

/** Só estas duas viram título — ver `criarTituloDeImposto`. */
const PAGA_POR_TITULO: Record<string, "vat" | "imposto"> = {
  VAT3: "vat",
  CT1: "imposto",
};

export type EstadoDePagamento = "nao_se_aplica" | "sem_titulo" | "aberto" | "parcial" | "pago";

export type PagamentoDaObrigacao = {
  estado: EstadoDePagamento;
  /** A referência do título, para a tela poder levar lá quem quiser ver. */
  ref: string | null;
  total: number | null;
  emAberto: number | null;
  /** A data da última baixa, quando já está pago. */
  pagoEm: string | null;
};

type ObrigacaoLida = {
  id: string; kind: string; period_label: string;
  period_start: string; period_end: string;
};

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * O estado de pagamento de cada obrigação da lista, numa consulta só.
 *
 * Uma consulta por linha daria catorze idas ao banco numa tela que já é lenta a
 * gerar o ano. Aqui monta-se a lista de referências e pergunta-se uma vez.
 */
export async function pagamentoDasObrigacoes(
  clientId: string, obrigacoes: ObrigacaoLida[]
): Promise<Record<string, PagamentoDaObrigacao>> {
  const fora: PagamentoDaObrigacao = {
    estado: "nao_se_aplica", ref: null, total: null, emAberto: null, pagoEm: null,
  };

  const refPorId = new Map<string, string>();
  for (const o of obrigacoes) {
    const tipo = PAGA_POR_TITULO[o.kind];
    if (!tipo) continue;
    refPorId.set(o.id, referencia(tipo, o.period_label, o.period_start, o.period_end));
  }

  const saida: Record<string, PagamentoDaObrigacao> = {};
  for (const o of obrigacoes) saida[o.id] = refPorId.has(o.id)
    ? { estado: "sem_titulo", ref: refPorId.get(o.id)!, total: null, emAberto: null, pagoEm: null }
    : fora;

  const refs = Array.from(new Set(refPorId.values()));
  if (!refs.length) return saida;

  const sb = getServerSupabase();
  const { data: titulos } = await sb.from("ledger_items_open")
    .select("id,document_ref,original_amount,charges_amount,outstanding_amount,status")
    .eq("client_id", clientId).eq("kind", "payable").in("document_ref", refs);

  const porRef = new Map<string, any>();
  for (const t of ((titulos ?? []) as any[])) porRef.set(t.document_ref, t);

  /*
   * A data da baixa vem das BAIXAS, e não do título.
   *
   * O título sabe quanto falta, não quando se pagou — e "pago" sem data diz
   * metade do que interessa quando alguém pergunta se foi dentro do prazo.
   */
  const ids = Array.from(porRef.values()).map((t) => t.id);
  const ultimaBaixa = new Map<string, string>();
  if (ids.length) {
    const { data: baixas } = await sb.from("ledger_settlements")
      .select("ledger_item_id,settled_on").in("ledger_item_id", ids);
    for (const b of ((baixas ?? []) as any[])) {
      const atual = ultimaBaixa.get(b.ledger_item_id);
      if (!atual || b.settled_on > atual) ultimaBaixa.set(b.ledger_item_id, b.settled_on);
    }
  }

  for (const [id, ref] of refPorId) {
    const t = porRef.get(ref);
    if (!t) continue;
    const emAberto = r2(t.outstanding_amount);
    saida[id] = {
      estado: t.status === "settled" ? "pago" : t.status === "partial" ? "parcial" : "aberto",
      ref,
      total: r2(t.original_amount) + r2(t.charges_amount),
      emAberto,
      pagoEm: t.status === "settled" ? (ultimaBaixa.get(t.id) ?? null) : null,
    };
  }
  return saida;
}
