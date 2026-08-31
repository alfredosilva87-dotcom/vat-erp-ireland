import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { integracoesDo } from "@/lib/integrations";

/**
 * Os TÍTULOS — contas a pagar e a receber.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO SAIU DE DENTRO DA CONTABILIZAÇÃO
 *
 * O título nascia dentro de `postInvoice`/`postSaleDoc`, ou seja, só existia
 * para quem contabilizava. Duas consequências erradas:
 *
 *   - o cliente que não usa o módulo contábil não tinha contas a pagar
 *     nenhuma, quando é justamente ele quem mais precisa de uma lista simples
 *     do que deve;
 *   - e não havia como ligar uma coisa sem a outra.
 *
 * Agora o título é um fato próprio: nasce do DOCUMENTO, não do lançamento. O
 * `journal_id` continua a ser preenchido quando há contabilização, porque é
 * bom saber qual lançamento o acompanha — mas é anulável, e um título sem
 * lançamento é um título válido.
 * ---------------------------------------------------------------------------
 *
 * Idempotente pelo documento: chamar duas vezes não cria dois títulos. Sem
 * isso, contabilizar depois de já ter lançado a nota duplicaria a dívida — e
 * uma lista de contas a pagar com o mesmo fornecedor duas vezes é pior do que
 * não ter lista nenhuma.
 */

const VENCIMENTO_PADRAO_DIAS = 30;

const somarDias = (iso: string, dias: number): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

const sb = () => getServerSupabase();

/** O título deste documento, se já existir. */
async function existente(clientId: string, documentId: string): Promise<string | null> {
  const { data } = await sb().from("ledger_items")
    .select("id").eq("client_id", clientId).eq("document_id", documentId).maybeSingle();
  return (data as any)?.id ?? null;
}

/**
 * A referência de um documento que não tem número.
 *
 * ---------------------------------------------------------------------------
 * POR QUE INVENTAR UMA
 *
 * Nem todo documento traz número: recibo de balcão, talão de posto, e nota
 * estrangeira em que o leitor não achou o campo. Até aqui o título nascia com
 * `document_ref` nulo, e o resultado era uma linha em branco na coluna
 * "Documento" de contas a pagar e a receber.
 *
 * Em branco não é só feio — é inutilizável. Não se procura por ele, não se
 * cita ao fornecedor, não se aponta numa conferência, e duas notas sem número
 * do mesmo fornecedor ficam indistinguíveis na lista.
 *
 * A referência é DERIVADA do id, então é estável: contabilizar de novo dá a
 * mesma, e ela não muda se alguém corrigir a data. O prefixo `S/N` diz o que
 * é — um substituto, não um número que veio do papel — para ninguém o citar
 * ao fornecedor a pensar que é o número da fatura dele.
 * ---------------------------------------------------------------------------
 */
export function refDoDocumento(numero: string | null | undefined, id: string): string {
  const limpo = String(numero ?? "").trim();
  if (limpo) return limpo;
  return `S/N-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export type ResultadoTitulo = { id: string | null; jaExistia: boolean; ignorado?: string };

/**
 * Garante o título de uma nota de compra.
 *
 * `journalId` só entra quando quem chama é a contabilização. Quando o título
 * nasce antes do lançamento fica sem — e é ligado depois, se e quando o
 * documento for contabilizado.
 */
export async function garantirTituloDeCompra(
  invoiceId: string, journalId?: string | null
): Promise<ResultadoTitulo> {
  const { data: nota } = await sb().from("invoices")
    .select("id,client_id,supplier_name,invoice_number,invoice_date,posting_date,total_gross,reviewed_at")
    .eq("id", invoiceId).maybeSingle();
  const n = nota as any;
  if (!n?.client_id) return { id: null, jaExistia: false, ignorado: "Nota sem cliente." };

  /*
   * NÃO INTEGRA O QUE NINGUÉM CONFERIU.
   *
   * Pedido do Alfredo: "deveria ir para contas a pagar e receber após informar
   * conferida, mesmo que puxe na função contabilizar, ele enxergar se está
   * conferida ou não".
   *
   * A carga retroativa já verificava isto — mas era o único caminho que
   * verificava, e não é o único caminho. Contabilizar um documento à mão
   * chegava aqui sem passar por lá, e um título nascia de um número que
   * ninguém validou: quem abre contas a pagar vê uma dívida com o valor que a
   * extração leu, que é precisamente o que `reviewed_at` existe para separar.
   *
   * A verificação fica AQUI, no sítio por onde todos passam, e não em cada
   * chamador — pela mesma razão que o cadeado do período é um gatilho.
   */
  if (!n.reviewed_at) {
    return { id: null, jaExistia: false, ignorado: "Falta conferir a nota para ela integrar." };
  }

  const ja = await existente(n.client_id, invoiceId);
  if (ja) {
    // Já existe: se agora há lançamento e o título não tinha, liga os dois.
    if (journalId) {
      await sb().from("ledger_items").update({ journal_id: journalId }).eq("id", ja).is("journal_id", null);
    }
    return { id: ja, jaExistia: true };
  }

  const integra = await integracoesDo(n.client_id);
  if (!integra.purchases_to_payable) {
    return { id: null, jaExistia: false, ignorado: "Integracao compras->pagar desligada." };
  }

  const bruto = Number(n.total_gross) || 0;
  // Nota a zero não vira dívida. Acontece em documento mal lido, e um título de
  // €0,00 na lista é ruído que ninguém sabe fechar.
  if (bruto <= 0) return { id: null, jaExistia: false, ignorado: "Nota sem valor." };

  const dataDoc = n.invoice_date || n.posting_date || new Date().toISOString().slice(0, 10);
  const { data, error } = await sb().from("ledger_items").insert({
    client_id: n.client_id, kind: "payable", source_module: "purchase",
    document_id: invoiceId, document_ref: refDoDocumento(n.invoice_number, invoiceId),
    counterparty: n.supplier_name, issue_date: dataDoc,
    due_date: somarDias(dataDoc, VENCIMENTO_PADRAO_DIAS),
    original_amount: bruto, journal_id: journalId ?? null,
    notes: "Vencimento estimado em 30 dias",
  }).select("id").single();
  if (error) return { id: null, jaExistia: false, ignorado: error.message };
  return { id: (data as any).id, jaExistia: false };
}

/** Garante o título de uma venda. Mesmas regras, do outro lado. */
export async function garantirTituloDeVenda(
  saleId: string, journalId?: string | null
): Promise<ResultadoTitulo> {
  const { data: venda } = await sb().from("sales")
    .select("id,client_id,customer,doc_number,entry_date,net_amount,vat_amount,reviewed_at")
    .eq("id", saleId).maybeSingle();
  const v = venda as any;
  if (!v?.client_id) return { id: null, jaExistia: false, ignorado: "Venda sem cliente." };

  // Ver `garantirTituloDeCompra`: o que ninguém conferiu não vira título.
  if (!v.reviewed_at) {
    return { id: null, jaExistia: false, ignorado: "Falta conferir a venda para ela integrar." };
  }

  const ja = await existente(v.client_id, saleId);
  if (ja) {
    if (journalId) {
      await sb().from("ledger_items").update({ journal_id: journalId }).eq("id", ja).is("journal_id", null);
    }
    return { id: ja, jaExistia: true };
  }

  const integra = await integracoesDo(v.client_id);
  if (!integra.sales_to_receivable) {
    return { id: null, jaExistia: false, ignorado: "Integracao vendas->receber desligada." };
  }

  /*
   * O bruto sai do cabeçalho, e as LINHAS são a rede — igual ao lançamento.
   *
   * Este era o mesmo defeito em segundo sítio, e mais silencioso: corrigida
   * só a contabilização, a venda da Renner passou a entrar no razão e mesmo
   * assim NÃO abria título. Ficava o pior dos dois mundos — receita
   * reconhecida no DRE e nada em contas a receber, com a conta de controlo
   * 1200 a deixar de bater com o aging por exactamente esse valor.
   *
   * Ver `postSaleDoc` em lib/accounting/service.ts, que faz a mesma coisa.
   */
  let bruto = (Number(v.net_amount) || 0) + (Number(v.vat_amount) || 0);
  if (bruto <= 0) {
    const { data: linhas } = await sb().from("sales_items")
      .select("net_amount,vat_amount").eq("sale_id", saleId);
    bruto = Math.round(((linhas ?? []) as any[]).reduce(
      (t, l) => t + (Number(l.net_amount) || 0) + (Number(l.vat_amount) || 0), 0) * 100) / 100;
  }
  if (bruto <= 0) return { id: null, jaExistia: false, ignorado: "Venda sem valor." };

  const data0 = v.entry_date || new Date().toISOString().slice(0, 10);
  const { data, error } = await sb().from("ledger_items").insert({
    client_id: v.client_id, kind: "receivable", source_module: "sale",
    document_id: saleId, document_ref: refDoDocumento(v.doc_number, saleId),
    counterparty: v.customer, issue_date: data0,
    due_date: somarDias(data0, VENCIMENTO_PADRAO_DIAS),
    original_amount: bruto, journal_id: journalId ?? null,
    notes: "Vencimento estimado em 30 dias",
  }).select("id").single();
  if (error) return { id: null, jaExistia: false, ignorado: error.message };
  return { id: (data as any).id, jaExistia: false };
}
