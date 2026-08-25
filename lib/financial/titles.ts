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
    .select("id,client_id,supplier_name,invoice_number,invoice_date,posting_date,total_gross")
    .eq("id", invoiceId).maybeSingle();
  const n = nota as any;
  if (!n?.client_id) return { id: null, jaExistia: false, ignorado: "Nota sem cliente." };

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
    document_id: invoiceId, document_ref: n.invoice_number,
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
    .select("id,client_id,customer,doc_number,entry_date,net_amount,vat_amount")
    .eq("id", saleId).maybeSingle();
  const v = venda as any;
  if (!v?.client_id) return { id: null, jaExistia: false, ignorado: "Venda sem cliente." };

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

  const bruto = (Number(v.net_amount) || 0) + (Number(v.vat_amount) || 0);
  if (bruto <= 0) return { id: null, jaExistia: false, ignorado: "Venda sem valor." };

  const data0 = v.entry_date || new Date().toISOString().slice(0, 10);
  const { data, error } = await sb().from("ledger_items").insert({
    client_id: v.client_id, kind: "receivable", source_module: "sale",
    document_id: saleId, document_ref: v.doc_number,
    counterparty: v.customer, issue_date: data0,
    due_date: somarDias(data0, VENCIMENTO_PADRAO_DIAS),
    original_amount: bruto, journal_id: journalId ?? null,
    notes: "Vencimento estimado em 30 dias",
  }).select("id").single();
  if (error) return { id: null, jaExistia: false, ignorado: error.message };
  return { id: (data as any).id, jaExistia: false };
}
