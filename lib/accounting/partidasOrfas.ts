import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { separarOrfas, type PartidaOrfa } from "@/lib/accounting/partidasOrfasPuro";
import { CONTAS_PADRAO } from "@/lib/accounting/post";

/**
 * O lado com BANCO da deteccao de partidas orfas.
 *
 * A regra — o que conta como orfa, e quanto ela empurra a conta de controlo
 * — vive em `partidasOrfasPuro.ts`, sem `server-only` e sem supabase, para
 * poder ser testada sem banco. Aqui so se le.
 */

/**
 * Lê uma tabela inteira PAGINADA, devolvendo só os ids.
 *
 * O PostgREST corta em 1000 linhas **sem avisar**. Aqui isso não daria um
 * número errado — daria uma acusação errada: tudo o que ficasse de fora da
 * primeira página passaria por inexistente, e a rotina apontaria centenas de
 * partidas saudáveis como lixo contábil. Mesma lição de `lib/accounting/query.ts`.
 */
async function idsDe(tabela: string, filtro: (q: any) => any): Promise<Set<string>> {
  const sb = getServerSupabase();
  const ids = new Set<string>();
  const PAGINA = 1000;
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await filtro(sb.from(tabela).select("id"))
      .order("id", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    const lote = (data ?? []) as { id: string }[];
    for (const r of lote) ids.add(r.id);
    if (lote.length < PAGINA) break;
  }
  return ids;
}

export async function partidasOrfasDoCliente(clientId: string): Promise<PartidaOrfa[]> {
  const sb = getServerSupabase();

  /*
   * PAGINADO, e `.limit(20000)` NÃO chega.
   *
   * O PostgREST tem `PGRST_DB_MAX_ROWS` a 1000 por omissão e corta aí, sem
   * erro e sem aviso — o `limit` do cliente não levanta o tecto do servidor.
   * Apanhado a testar: um cliente com 1634 linhas no razão, duas partidas
   * órfãs verdadeiras a seguir à milésima, e esta rotina a responder "está
   * tudo bem". É o pior resultado possível numa rotina de verificação: ela
   * existe precisamente para ser acreditada quando diz que não há nada.
   *
   * Mesma lição de `lib/accounting/query.ts` e de `conciliarControlo`.
   */
  const PAGINA = 1000;
  const linhas: any[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await sb.from("journal_lines")
      .select("account_code,debit,credit,journal!inner(id,posting_date,source_module,document_id,document_ref,client_id)")
      .eq("journal.client_id", clientId)
      .order("journal_id", { ascending: true })
      .order("line_no", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as any[];
    linhas.push(...lote);
    if (lote.length < PAGINA) break;
  }

  type Agrupada = {
    journalId: string; postingDate: string; sourceModule: string;
    documentId: string | null; documentRef: string | null;
    contas: { code: string; debit: number; credit: number }[];
  };
  const porLancamento = new Map<string, Agrupada>();
  for (const l of linhas) {
    const j = l.journal;
    const a: Agrupada = porLancamento.get(j.id) ?? {
      journalId: j.id, postingDate: j.posting_date, sourceModule: j.source_module,
      documentId: j.document_id, documentRef: j.document_ref, contas: [],
    };
    a.contas.push({ code: l.account_code, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 });
    porLancamento.set(j.id, a);
  }

  /*
   * As baixas e os encargos entram pelo TÍTULO, e não por cliente.
   *
   * `ledger_settlements` e `ledger_charges` não têm `client_id` — a empresa
   * delas vem do título. Mas o que se precisa saber aqui é só "este id ainda
   * existe?", e para isso a tabela inteira serve: um id de outra empresa nunca
   * vai colidir com o `document_id` desta.
   */
  const [invoices, sales, bankTransactions, charges, ledgerItems] = await Promise.all([
    idsDe("invoices", (q) => q.eq("client_id", clientId)),
    idsDe("sales", (q) => q.eq("client_id", clientId)),
    idsDe("bank_transactions", (q) => q.eq("client_id", clientId)),
    idsDe("ledger_charges", (q) => q),
    idsDe("ledger_items", (q) => q.eq("client_id", clientId)),
  ]);

  /*
   * As baixas que ainda reclamam uma partida, e as contas de CONTROLO.
   *
   * Servem a segunda regra (ver `separarOrfas`): uma partida de banco que mexe
   * na conta de controlo tem de ter uma baixa a apontar-lhe. As contas vêm do
   * padrão MAIS as próprias dos títulos — o escritório que separa fornecedores
   * tem títulos em contas suas, e ler só 812/711 deixaria essas de fora.
   */
  const { data: baixas } = await sb.from("ledger_settlements")
    .select("journal_id,ledger_item:ledger_items!inner(client_id)")
    .eq("ledger_item.client_id", clientId).not("journal_id", "is", null).limit(20000);
  const settlementJournals = new Set(
    ((baixas ?? []) as any[]).map((b) => b.journal_id as string));

  // Os originais que já têm estorno a apontar-lhes: efeito zero, e por isso
  // fora da lista. Ver o comentário em `separarOrfas`.
  const { data: espelhos } = await sb.from("journal")
    .select("reverses").eq("client_id", clientId).not("reverses", "is", null).limit(20000);
  const estornados = new Set(((espelhos ?? []) as any[]).map((e) => e.reverses as string));

  const { data: proprias } = await sb.from("ledger_items")
    .select("account_code").eq("client_id", clientId).not("account_code", "is", null);
  const contasDeControlo = new Set<string>([
    CONTAS_PADRAO.tradeCreditors, CONTAS_PADRAO.tradeDebtors,
    ...((proprias ?? []) as any[]).map((t) => String(t.account_code).trim()).filter(Boolean),
  ]);

  return separarOrfas([...porLancamento.values()], {
    invoices, sales, bankTransactions, charges, ledgerItems,
    settlementJournals, contasDeControlo, estornados,
  });
}
