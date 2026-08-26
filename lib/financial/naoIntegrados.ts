import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { integracoesDo } from "@/lib/integrations";

/**
 * O que NÃO chegou a contas a pagar/receber, e porquê.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UMA TELA SÓ PARA ISTO
 *
 * A integração falha em silêncio de várias maneiras diferentes, e todas se
 * parecem no ecrã: o documento está gravado, aparece na lista de compras ou de
 * vendas, e simplesmente não existe em contas a pagar. Sem um sítio que junte
 * essas causas, a única forma de descobrir é somar as duas listas à mão.
 *
 * As causas são estas, e cada uma pede uma acção diferente:
 *
 *   por conferir  → alguém tem de olhar e aprovar
 *   integração desligada → é a configuração do cliente, não é defeito
 *   sem valor     → a leitura falhou; corrigir o documento
 *   data futura   → o motor não lança documento que ainda não aconteceu
 *   devolvido     → foi tirado de propósito para correção, e falta reintegrar
 *   erro          → tentou e o motor recusou
 *
 * Juntar "não é defeito" com "erro" na mesma lista faria a lista crescer com
 * coisas que ninguém tem de tratar — e uma lista assim deixa de ser lida.
 * Por isso cada linha diz o motivo, e o motivo diz o que fazer.
 * ---------------------------------------------------------------------------
 */

export type MotivoNaoIntegrado =
  | "por_conferir"
  | "integracao_desligada"
  | "sem_valor"
  | "data_futura"
  | "devolvido";

export type DocumentoNaoIntegrado = {
  id: string;
  origem: "purchase" | "sale";
  documentRef: string | null;
  contraparte: string | null;
  data: string | null;
  valor: number;
  motivo: MotivoNaoIntegrado;
  /** Tem partida no razão mas não tem título — meia-integração. */
  meiaIntegracao: boolean;
};

export type ResumoNaoIntegrados = {
  itens: DocumentoNaoIntegrado[];
  /** Contagem por motivo, para o cabeçalho da tela. */
  porMotivo: Record<string, number>;
  /** Documentos que o razão conhece e a lista de títulos não, ou o inverso. */
  meiasIntegracoes: number;
};

const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
const HOJE = () => new Date().toISOString().slice(0, 10);

export async function documentosNaoIntegrados(clientId: string): Promise<ResumoNaoIntegrados> {
  const sb = getServerSupabase();
  const hoje = HOJE();
  const integra = await integracoesDo(clientId);

  const [{ data: compras }, { data: vendas }, { data: titulos }, { data: lancs }] = await Promise.all([
    sb.from("invoices")
      .select("id,invoice_number,supplier_name,invoice_date,posting_date,total_gross,reviewed_at")
      .eq("client_id", clientId),
    sb.from("sales")
      .select("id,doc_number,customer,entry_date,net_amount,vat_amount,reviewed_at")
      .eq("client_id", clientId),
    sb.from("ledger_items").select("document_id").eq("client_id", clientId).not("document_id", "is", null),
    sb.from("journal").select("document_id,source_module")
      .eq("client_id", clientId).in("source_module", ["purchase", "sale"]),
  ]);

  const comTitulo = new Set(((titulos ?? []) as any[]).map((t) => t.document_id));
  const comLancamento = new Set(((lancs ?? []) as any[]).map((j) => j.document_id));

  const itens: DocumentoNaoIntegrado[] = [];

  const avaliar = (
    id: string, origem: "purchase" | "sale", ref: string | null,
    contraparte: string | null, data: string | null, valor: number,
    conferido: boolean, integracaoLigada: boolean
  ) => {
    const temTitulo = comTitulo.has(id);
    const temLancamento = comLancamento.has(id);
    if (temTitulo && temLancamento) return;

    /*
     * A ordem das causas importa: a primeira que responder é a que se mostra,
     * e tem de ser a que a pessoa resolve primeiro. Dizer "sem valor" a um
     * documento que nem foi conferido manda-a corrigir um número que ela ainda
     * não olhou.
     */
    let motivo: MotivoNaoIntegrado;
    if (!integracaoLigada) motivo = "integracao_desligada";
    else if (!conferido) motivo = "por_conferir";
    else if (data && data > hoje) motivo = "data_futura";
    else if (valor <= 0) motivo = "sem_valor";
    else motivo = "devolvido";

    itens.push({
      id, origem, documentRef: ref, contraparte, data, valor, motivo,
      // Um lado sem o outro é meia-integração — o estado que a conciliação da
      // conta de controlo acusa sem conseguir dizer de onde vem.
      meiaIntegracao: temTitulo !== temLancamento,
    });
  };

  for (const c of ((compras ?? []) as any[])) {
    avaliar(
      c.id, "purchase", c.invoice_number ?? null, c.supplier_name ?? null,
      c.invoice_date ?? c.posting_date ?? null, num(c.total_gross),
      Boolean(c.reviewed_at), integra.purchases_to_payable
    );
  }
  for (const v of ((vendas ?? []) as any[])) {
    avaliar(
      v.id, "sale", v.doc_number ?? null, v.customer ?? null,
      v.entry_date ?? null, num(v.net_amount) + num(v.vat_amount),
      Boolean(v.reviewed_at), integra.sales_to_receivable
    );
  }

  itens.sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));

  const porMotivo: Record<string, number> = {};
  for (const i of itens) porMotivo[i.motivo] = (porMotivo[i.motivo] ?? 0) + 1;

  return {
    itens,
    porMotivo,
    meiasIntegracoes: itens.filter((i) => i.meiaIntegracao).length,
  };
}
