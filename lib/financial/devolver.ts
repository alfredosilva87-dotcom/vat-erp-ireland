import "server-only";
import { getServerSupabase } from "@/lib/supabase";

/**
 * DEVOLVER o documento: desfazer a integração para poder corrigi-lo.
 *
 * ---------------------------------------------------------------------------
 * O BURACO QUE ISTO FECHA
 *
 * Apagar uma nota de compra ou uma venda não conferia nada. O documento ia-se
 * embora e ficavam para trás o título em contas a pagar/receber e a partida no
 * razão, ambos a apontar para um documento que já não existe.
 *
 * O estado resultante é o pior que este sistema pode ter:
 *
 *   - o balancete e o DRE continuam a contar um documento que ninguém
 *     consegue abrir;
 *   - o título continua na lista de pagar/receber, e quem o clicar não chega
 *     a lado nenhum;
 *   - a conciliação da conta de controlo continua a fechar — os dois lados
 *     ficaram órfãos juntos — então nem o painel de conciliação avisa.
 *
 * Aconteceu a sério em 2026-08-26, com dois documentos de teste apagados pela
 * tela de compras e vendas.
 *
 * A ordem certa é a que o Logix chama DEVOLVER o documento: primeiro tira-se
 * de contas a pagar/receber e do razão, e só então o documento pode ser
 * corrigido ou apagado. É o inverso exacto da integração.
 * ---------------------------------------------------------------------------
 *
 * O que NÃO se devolve: um documento cujo título já teve dinheiro a passar.
 * Uma baixa é um facto do banco, e um encargo é uma decisão de alguém — apagar
 * o título por baixo deles deixaria a baixa órfã e o extrato a apontar para
 * nada. Nesses casos a mensagem diz o que desfazer primeiro, e por que ordem.
 */

export type Origem = "purchase" | "sale";

export type EstadoDaIntegracao = {
  /** Tem título em contas a pagar/receber. */
  temTitulo: boolean;
  titleId: string | null;
  documentRef: string | null;
  /** Tem partida no razão. */
  temLancamento: boolean;
  journalIds: string[];
  /** Baixas já feitas contra o título — dinheiro que passou pelo banco. */
  baixas: number;
  /** Encargos lançados no título — juro, taxa, multa, desconto. */
  encargos: number;
  /** Integrado de alguma forma: há o que devolver antes de apagar. */
  integrado: boolean;
};

export async function estadoDaIntegracao(
  clientId: string, documentId: string, origem: Origem
): Promise<EstadoDaIntegracao> {
  const sb = getServerSupabase();

  const [{ data: titulos }, { data: lancs }] = await Promise.all([
    sb.from("ledger_items").select("id,document_ref")
      .eq("client_id", clientId).eq("document_id", documentId),
    sb.from("journal").select("id")
      .eq("client_id", clientId).eq("source_module", origem).eq("document_id", documentId),
  ]);

  const t = ((titulos ?? []) as any[])[0] ?? null;
  const ids = ((titulos ?? []) as any[]).map((x) => x.id);

  let baixas = 0;
  let encargos = 0;
  if (ids.length) {
    const [{ count: nb }, { count: ne }] = await Promise.all([
      sb.from("ledger_settlements").select("id", { count: "exact", head: true }).in("ledger_item_id", ids),
      sb.from("ledger_charges").select("id", { count: "exact", head: true }).in("ledger_item_id", ids),
    ]);
    baixas = nb ?? 0;
    encargos = ne ?? 0;
  }

  const journalIds = ((lancs ?? []) as any[]).map((x) => x.id);
  return {
    temTitulo: ids.length > 0,
    titleId: t?.id ?? null,
    documentRef: t?.document_ref ?? null,
    temLancamento: journalIds.length > 0,
    journalIds,
    baixas,
    encargos,
    integrado: ids.length > 0 || journalIds.length > 0,
  };
}

export type ResultadoDevolucao =
  | { ok: true; titulosRemovidos: number; lancamentosRemovidos: number }
  | { ok: false; erro: string };

/**
 * Devolve o documento: apaga o título e a partida, e deixa o documento intacto.
 *
 * Depois disto o documento volta ao estado de "por integrar": pode ser
 * corrigido e contabilizado de novo, ou apagado.
 */
export async function devolverDocumento(
  clientId: string, documentId: string, origem: Origem
): Promise<ResultadoDevolucao> {
  const sb = getServerSupabase();
  const estado = await estadoDaIntegracao(clientId, documentId, origem);

  if (!estado.integrado) {
    return { ok: false, erro: "Este documento não está integrado — não há o que devolver." };
  }

  /*
   * Dinheiro que já passou tranca a devolução, e a mensagem diz por que ordem
   * desfazer. "Não pode" sem dizer o que fazer a seguir manda a pessoa
   * procurar, e o sítio onde ela procura primeiro é o errado.
   */
  if (estado.baixas > 0) {
    return {
      ok: false,
      erro: `O título ${estado.documentRef ?? ""} já tem ${estado.baixas} baixa(s). `
        + "Desfaça as baixas no painel do título (Financeiro → contas a pagar/receber) antes de devolver o documento.",
    };
  }
  if (estado.encargos > 0) {
    return {
      ok: false,
      erro: `O título ${estado.documentRef ?? ""} tem ${estado.encargos} encargo(s) lançado(s). `
        + "Remova os encargos no painel do título antes de devolver o documento.",
    };
  }

  // O título primeiro: se o razão fosse apagado antes e o título falhasse,
  // ficava um título sem partida — o mesmo tipo de meia-integração que esta
  // função existe para evitar.
  const { error: e1, data: apagados } = await sb.from("ledger_items")
    .delete().eq("client_id", clientId).eq("document_id", documentId).select("id");
  if (e1) return { ok: false, erro: e1.message };

  const { error: e2, data: js } = await sb.from("journal")
    .delete().eq("client_id", clientId).eq("source_module", origem).eq("document_id", documentId).select("id");
  if (e2) return { ok: false, erro: e2.message };

  return {
    ok: true,
    titulosRemovidos: ((apagados ?? []) as any[]).length,
    lancamentosRemovidos: ((js ?? []) as any[]).length,
  };
}

/**
 * A trava do APAGAR: um documento integrado não se apaga.
 *
 * Devolve a mensagem quando não pode, ou `null` quando pode seguir. Vive aqui
 * e não na tela porque a tela é só um dos caminhos — a rota de API responde a
 * quem a chamar, e uma trava que depende de a tela se lembrar dela tem buraco.
 */
export async function impedimentoParaApagar(
  clientId: string, documentId: string, origem: Origem
): Promise<string | null> {
  const estado = await estadoDaIntegracao(clientId, documentId, origem);
  if (!estado.integrado) return null;

  const onde = origem === "purchase" ? "contas a pagar" : "contas a receber";
  const partes: string[] = [];
  if (estado.temTitulo) partes.push(`título em ${onde}`);
  if (estado.temLancamento) partes.push("partida no razão");

  return `Este documento está integrado (${partes.join(" e ")}). `
    + "Devolva-o primeiro — o botão Devolver, no próprio documento — e só então apague. "
    + "Apagar por cima deixaria o razão a contar um documento que já não existe.";
}
