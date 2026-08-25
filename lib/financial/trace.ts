import "server-only";
import { getServerSupabase } from "@/lib/supabase";

/**
 * O RASTRO de um documento: para onde ele foi depois de gravado.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO EXISTE
 *
 * A ligação sempre existiu, mas só num sentido. `ledger_items.document_id` e
 * `journal.document_id` apontam para a nota, então do título ou do razão
 * chega-se ao documento. Ao contrário não havia caminho nenhum: aberta a
 * nota, nada no ecrã dizia se ela tinha sido contabilizada, nem em que conta
 * a pagar ou a receber tinha caído.
 *
 * Numa conferência isso obriga a procurar o número da nota na lista de
 * títulos, e a resposta "não encontrei" fica ambígua: pode ser que não foi
 * integrada, pode ser que o número está diferente, pode ser que se procurou
 * na lista errada. Nenhuma dessas três hipóteses é distinguível a olho, e as
 * três levam a acções diferentes.
 *
 * É requisito de auditoria antes de ser conveniência: a pergunta "este
 * documento virou o quê?" tem de ter uma resposta, e a resposta tem de ser a
 * mesma que o razão dá.
 * ---------------------------------------------------------------------------
 *
 * **É VISTA, nunca coluna.** Não existe `invoices.integrada` nem
 * `invoices.ledger_item_id`. Uma coluna dessas é uma segunda verdade: no dia
 * em que alguém apagar o título por SQL, ou o lançamento for estornado, a
 * marca fica a mentir e o ecrã diz "integrada" apontando para nada. O saldo
 * dos títulos segue a mesma regra pelo mesmo motivo — ver `ledger_items_open`.
 */

export type TituloDoDocumento = {
  id: string;
  kind: "payable" | "receivable";
  documentRef: string | null;
  counterparty: string | null;
  dueDate: string | null;
  originalAmount: number;
  chargesAmount: number;
  settledAmount: number;
  outstandingAmount: number;
  status: string;
};

export type RastroDoDocumento = {
  /** Tem partida no razão. */
  posted: boolean;
  journalId: string | null;
  /** Data CONTÁBIL do lançamento — pode não ser a data da nota. */
  postedOn: string | null;
  /** Os títulos que este documento abriu. Lista, e não um só, porque uma
   *  nota parcelada abre um título por parcela. */
  titles: TituloDoDocumento[];
};

const num = (v: unknown): number => Math.round((Number(v) || 0) * 100) / 100;

/**
 * O rastro de UM documento.
 *
 * `origem` diz de que lado ele está, porque `document_id` só é único dentro
 * do módulo: uma nota de compra e uma venda podem, em teoria, ter o mesmo id
 * se um dia os ids deixarem de ser uuid. Filtrar pelo módulo custa nada e
 * fecha essa porta antes de ela abrir.
 */
export async function rastroDoDocumento(
  clientId: string,
  documentId: string,
  origem: "purchase" | "sale"
): Promise<RastroDoDocumento> {
  const sb = getServerSupabase();

  const [{ data: lanc }, { data: titulos }] = await Promise.all([
    sb.from("journal")
      .select("id,posting_date")
      .eq("source_module", origem)
      .eq("document_id", documentId)
      .order("posting_date", { ascending: true })
      .limit(1),
    sb.from("ledger_items_open")
      .select("id,kind,document_ref,counterparty,due_date,original_amount," +
              "charges_amount,settled_amount,outstanding_amount,status")
      .eq("client_id", clientId)
      .eq("document_id", documentId)
      // Ordem estável: sem ela, duas parcelas do mesmo vencimento trocam de
      // lugar entre duas aberturas e o ecrã parece mudar sozinho.
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("document_ref", { ascending: true }),
  ]);

  const cabecalho = (lanc ?? [])[0] as any;
  return {
    posted: Boolean(cabecalho),
    journalId: cabecalho?.id ?? null,
    postedOn: cabecalho?.posting_date ?? null,
    titles: ((titulos ?? []) as any[]).map((t) => ({
      id: t.id,
      kind: t.kind,
      documentRef: t.document_ref ?? null,
      counterparty: t.counterparty ?? null,
      dueDate: t.due_date ?? null,
      originalAmount: num(t.original_amount),
      chargesAmount: num(t.charges_amount),
      settledAmount: num(t.settled_amount),
      outstandingAmount: num(t.outstanding_amount),
      status: t.status,
    })),
  };
}

/**
 * O rastro de MUITOS documentos de uma vez, para a lista.
 *
 * A lista de compras mostra dezenas de linhas. Uma chamada por linha seriam
 * dezenas de idas ao banco para pintar um ícone — e a tela ficaria mais lenta
 * exactamente por causa da coluna que existe para poupar trabalho.
 *
 * Devolve um mapa por `document_id`; documento sem entrada é documento sem
 * rastro nenhum.
 */
export async function rastroDeVarios(
  clientId: string,
  documentIds: string[],
  origem: "purchase" | "sale"
): Promise<Map<string, RastroDoDocumento>> {
  const mapa = new Map<string, RastroDoDocumento>();
  if (!documentIds.length) return mapa;
  const sb = getServerSupabase();

  // Em lotes porque o `in` vai na URL do PostgREST e uma lista comprida
  // estoura o limite de tamanho do pedido — falha que aparece como erro de
  // rede e manda procurar no sítio errado.
  for (let i = 0; i < documentIds.length; i += 200) {
    const fatia = documentIds.slice(i, i + 200);
    const [{ data: lancs }, { data: titulos }] = await Promise.all([
      sb.from("journal").select("id,document_id,posting_date")
        .eq("source_module", origem).in("document_id", fatia),
      sb.from("ledger_items_open")
        .select("id,kind,document_id,document_ref,counterparty,due_date,original_amount," +
                "charges_amount,settled_amount,outstanding_amount,status")
        .eq("client_id", clientId).in("document_id", fatia),
    ]);

    for (const l of ((lancs ?? []) as any[])) {
      const r = mapa.get(l.document_id) ?? { posted: false, journalId: null, postedOn: null, titles: [] };
      r.posted = true;
      r.journalId = l.id;
      r.postedOn = l.posting_date;
      mapa.set(l.document_id, r);
    }
    for (const t of ((titulos ?? []) as any[])) {
      const r = mapa.get(t.document_id) ?? { posted: false, journalId: null, postedOn: null, titles: [] };
      r.titles.push({
        id: t.id, kind: t.kind, documentRef: t.document_ref ?? null,
        counterparty: t.counterparty ?? null, dueDate: t.due_date ?? null,
        originalAmount: num(t.original_amount), chargesAmount: num(t.charges_amount),
        settledAmount: num(t.settled_amount), outstandingAmount: num(t.outstanding_amount),
        status: t.status,
      });
      mapa.set(t.document_id, r);
    }
  }
  for (const r of mapa.values()) {
    r.titles.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")
      || (a.documentRef ?? "").localeCompare(b.documentRef ?? ""));
  }
  return mapa;
}
