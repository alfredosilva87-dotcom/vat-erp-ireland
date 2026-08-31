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
 *   sem valor     → a leitura falhou; corrigir o documento
 *   data futura   → o motor não lança documento que ainda não aconteceu
 *   devolvido     → foi tirado de propósito para correção, e falta reintegrar
 *
 * O que a configuração do cliente NÃO manda integrar não entra aqui de todo.
 * Juntar "não é defeito" com "erro" na mesma lista faria a lista crescer com
 * coisas que ninguém tem de tratar — e uma lista assim deixa de ser lida.
 * Por isso cada linha diz o motivo, e o motivo diz o que fazer.
 * ---------------------------------------------------------------------------
 */

export type MotivoNaoIntegrado =
  | "por_conferir"
  | "sem_valor"
  | "data_futura"
  | "devolvido"
  /**
   * O contrário de todos os outros: o documento ENTROU sem ninguém o conferir.
   *
   * Pedido do Alfredo, sobre uma fatura que ele viu em contas a receber por
   * conferir: "na rotina de verificar pendências precisa apontar essa
   * inconsistência".
   *
   * Ele tem razão, e o motivo é o mesmo dos outros: um número que ninguém
   * validou está a contar como dívida real e a somar na apuração. A partir de
   * agora não acontece — `garantirTitulo*`, `postInvoice` e `postSaleDoc` recusam o que não
   * está conferido —, mas o que já entrou assim continua lá, e só esta lista o
   * mostra.
   */
  | "integrado_sem_conferir";

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

  /*
   * O que se ESPERA deste documento depende da configuração do cliente.
   *
   * A primeira versão comparava contra "tem título E tem partida", sempre. Num
   * cliente com `documents_to_accounting` desligado — que é um caso previsto e
   * documentado, o cliente que quer só a lista do que deve — nenhum documento
   * tem partida, por desenho. Resultado: TODOS apareciam nesta tela marcados
   * como meia-integração, em cartão vermelho, descritos como "estado partido".
   *
   * Um cliente configurado correctamente a parecer inteiramente avariado é
   * pior do que não ter a tela: o alarme que devia apontar as meias-integrações
   * a sério passa a ser ruído, e quem o vê todos os dias deixa de o ler.
   *
   * Por isso a comparação é agora contra o ESPERADO, e não contra um ideal
   * fixo. Documento que está exactamente como a configuração manda não aparece.
   */
  const esperaLancamento = integra.documents_to_accounting;

  const avaliar = (
    id: string, origem: "purchase" | "sale", ref: string | null,
    contraparte: string | null, data: string | null, valor: number,
    conferido: boolean, esperaTitulo: boolean
  ) => {
    const temTitulo = comTitulo.has(id);
    const temLancamento = comLancamento.has(id);

    const faltaTitulo = esperaTitulo && !temTitulo;
    const faltaLancamento = esperaLancamento && !temLancamento;

    /*
     * O caso invertido vem PRIMEIRO, porque não é falta — é excesso.
     *
     * Um documento por conferir que já está em contas a pagar e no razão não
     * "falta" em lado nenhum, e por isso escapava a esta tela inteira: as
     * comparações abaixo só perguntam o que falta. É o estado mais silencioso
     * dos três, e o único em que o número errado já está a contar.
     */
    if (!conferido && (temTitulo || temLancamento)) {
      itens.push({
        id, origem, documentRef: ref, contraparte, data, valor,
        motivo: "integrado_sem_conferir", meiaIntegracao: false,
      });
      return;
    }

    // Está como devia estar — incluindo o cliente que não integra nada.
    if (!faltaTitulo && !faltaLancamento) return;

    /*
     * A ordem das causas importa: a primeira que responder é a que se mostra,
     * e tem de ser a que a pessoa resolve primeiro. Dizer "sem valor" a um
     * documento que nem foi conferido manda-a corrigir um número que ela ainda
     * não olhou.
     */
    let motivo: MotivoNaoIntegrado;
    if (!conferido) motivo = "por_conferir";
    else if (data && data > hoje) motivo = "data_futura";
    else if (valor <= 0) motivo = "sem_valor";
    else motivo = "devolvido";

    itens.push({
      id, origem, documentRef: ref, contraparte, data, valor, motivo,
      /*
       * Meia-integração só quando os DOIS lados são esperados e só um existe.
       *
       * É esse o estado partido que a conciliação da conta de controlo acusa
       * sem conseguir dizer de onde vem. Com um dos lados desligado por
       * configuração, ter um e não ter o outro é o comportamento correcto.
       */
      meiaIntegracao: esperaTitulo && esperaLancamento && temTitulo !== temLancamento,
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
