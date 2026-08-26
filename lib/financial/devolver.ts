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
  /**
   * Movimentos bancários agarrados a este documento.
   *
   * Contam mesmo quando não há título nenhum: a conciliação bancária deixa o
   * documento ser escolhido como contrapartida de uma linha do extrato sem
   * exigir que ele esteja integrado. Ver `bank_transactions.invoice_id`.
   */
  movimentosBanco: number;
  /** Desses, os que vieram de uma linha do EXTRATO — factos do banco. */
  movimentosDoExtrato: number;
  /** Integrado de alguma forma: há o que devolver antes de apagar. */
  integrado: boolean;
};

export async function estadoDaIntegracao(
  clientId: string, documentId: string, origem: Origem
): Promise<EstadoDaIntegracao> {
  const sb = getServerSupabase();

  /*
   * O banco entra na conta, e é a lacuna que a varredura de 2026-08-26 achou.
   *
   * `bank_transactions.invoice_id` e `.sale_id` são `on delete cascade`. Um
   * documento conciliado contra uma linha do extrato — coisa que a conciliação
   * permite mesmo sem o documento estar integrado — era apagado sem queixa, e
   * a cascata levava o movimento junto. A linha do extrato ficava marcada como
   * conciliada SEM movimento nenhum por trás: nunca mais voltava à fila, e o
   * fechamento passava a acusar uma diferença sem origem apontável.
   */
  const coluna = origem === "purchase" ? "invoice_id" : "sale_id";
  const [{ data: titulos }, { data: lancs }, { data: movs }] = await Promise.all([
    sb.from("ledger_items").select("id,document_ref")
      .eq("client_id", clientId).eq("document_id", documentId),
    sb.from("journal").select("id")
      .eq("client_id", clientId).eq("source_module", origem).eq("document_id", documentId),
    sb.from("bank_transactions").select("id,statement_line_id")
      .eq("client_id", clientId).eq(coluna, documentId),
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
  const movimentos = (movs ?? []) as any[];
  const doExtrato = movimentos.filter((m) => m.statement_line_id).length;

  return {
    temTitulo: ids.length > 0,
    titleId: t?.id ?? null,
    documentRef: t?.document_ref ?? null,
    temLancamento: journalIds.length > 0,
    journalIds,
    baixas,
    encargos,
    movimentosBanco: movimentos.length,
    movimentosDoExtrato: doExtrato,
    integrado: ids.length > 0 || journalIds.length > 0 || movimentos.length > 0,
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

  /*
   * Devolver trata de título e razão. Movimento do banco NÃO é isso.
   *
   * `integrado` passou a contar movimentos bancários, porque a trava do apagar
   * precisa deles. Mas devolver só remove título e partida: se o documento
   * está apenas conciliado com o banco, correr aqui apagaria zero linhas e
   * devolveria sucesso — que se lê como "resolvido" e não está.
   */
  if (!estado.temTitulo && !estado.temLancamento) {
    return {
      ok: false,
      erro: estado.movimentosBanco > 0
        ? "Este documento não tem título nem partida — está só conciliado com o banco. "
          + "Desfaça a conciliação na tela do extrato, com o Refazer."
        : "Este documento não está integrado — não há o que devolver.",
    };
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

  /*
   * O movimento do banco tem mensagem própria, e não é "devolva primeiro".
   *
   * Devolver não desfaz conciliação bancária — são coisas diferentes, e mandar
   * a pessoa carregar em Devolver para resolver isto fá-la-ia carregar, ver o
   * documento sair do razão, tentar apagar outra vez e voltar a ser recusada
   * pelo mesmo motivo. Diz-se onde se resolve: na conciliação, com o Refazer.
   */
  if (estado.movimentosBanco > 0) {
    const doExtrato = estado.movimentosDoExtrato > 0;
    return `Este documento está conciliado com ${estado.movimentosBanco} movimento(s) no banco. `
      + (doExtrato
        ? "Desfaça a conciliação primeiro — Refazer, na tela do extrato. "
          + "Apagar por cima levaria o movimento junto e deixaria a linha do extrato marcada "
          + "como conciliada sem nada por trás, fora da fila para sempre."
        : "Desfaça a baixa no painel do título antes de apagar.");
  }

  const partes: string[] = [];
  if (estado.temTitulo) partes.push(`título em ${onde}`);
  if (estado.temLancamento) partes.push("partida no razão");

  return `Este documento está integrado (${partes.join(" e ")}). `
    + "Devolva-o primeiro — o botão Devolver, no próprio documento — e só então apague. "
    + "Apagar por cima deixaria o razão a contar um documento que já não existe.";
}

/**
 * Os campos cuja alteração faz o razão divergir do documento.
 *
 * Nome do fornecedor, filial ou observação não mexem em contabilidade nenhuma
 * e continuam livres. Valor e data mexem: o título guarda o bruto e o
 * lançamento guarda a data contábil, e nenhum dos dois se actualiza sozinho.
 */
export const CAMPOS_CONTABEIS_COMPRA = [
  "total_net", "total_vat", "total_gross", "invoice_date", "posting_date",
];
export const CAMPOS_CONTABEIS_VENDA = [
  "net_amount", "vat_amount", "vat_rate", "entry_date",
];

/**
 * A trava do EDITAR: num documento integrado, valor e data não se mexem.
 *
 * ---------------------------------------------------------------------------
 * O QUE ACONTECIA
 *
 * Reabrir a aprovação de uma nota de €1.200 já contabilizada, corrigir para
 * €1.500 e gravar deixava três verdades diferentes: documento €1.500, título
 * €1.200, razão €1.200. Contabilizar de novo não repara — o documento já tem
 * lançamento, e tanto `postInvoice` como `garantirTitulo*` saem por "já
 * existia".
 *
 * O pior é que nada acusa. A conta de controlo bate com o aging (os dois estão
 * errados juntos), a tela de não-integrados não vê nada (tem título E partida),
 * e o VAT3 sai do documento — logo, com o valor novo. A contabilidade fica a
 * dizer uma coisa e o imposto outra, e a diferença só aparece numa conferência
 * manual meses depois.
 * ---------------------------------------------------------------------------
 *
 * Devolve a mensagem quando não pode, ou `null` quando pode seguir. Recebe já
 * os campos que MUDAM de valor — quem chama sabe comparar antes e depois; uma
 * gravação que reenvia o mesmo número não é alteração nenhuma.
 */
export async function impedimentoParaEditar(
  clientId: string, documentId: string, origem: Origem, camposAlterados: string[]
): Promise<string | null> {
  const contabeis = origem === "purchase" ? CAMPOS_CONTABEIS_COMPRA : CAMPOS_CONTABEIS_VENDA;
  const tocados = camposAlterados.filter((c) => contabeis.includes(c));
  if (!tocados.length) return null;

  const estado = await estadoDaIntegracao(clientId, documentId, origem);
  if (!estado.temTitulo && !estado.temLancamento) return null;

  return `Este documento já está integrado, e ${tocados.join(", ")} muda${tocados.length > 1 ? "m" : ""} `
    + "a contabilidade. Devolva o documento primeiro — o botão Devolver, no próprio documento —, "
    + "corrija, e contabilize de novo. Gravar por cima deixaria o título e o razão no valor antigo, "
    + "sem nada no ecrã a acusar a diferença.";
}
