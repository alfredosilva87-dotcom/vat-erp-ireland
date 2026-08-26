import "server-only";
import { garantirTituloDeCompra, garantirTituloDeVenda, refDoDocumento } from "@/lib/financial/titles";
import { integracoesDo } from "@/lib/integrations";
import { getServerSupabase } from "@/lib/supabase";
import {
  CONTAS_PADRAO, postBankDirect, postCharge, postPurchase, postSale, postSettlement,
  somaCredito, somaDebito, type PostingLine,
} from "@/lib/accounting/post";

/**
 * Quem escreve no razão.
 *
 * O cálculo do que lançar mora em `post.ts`, sem banco e testado sozinho.
 * Aqui é só o transporte: lê o documento, chama o motor, grava o
 * lançamento e o título. A separação existe porque a matemática contábil
 * erra em silêncio, e matemática que só se testa através do banco não
 * se testa.
 *
 * **Idempotente por documento.** Contabilizar duas vezes a mesma nota
 * dobraria a despesa e o passivo, e ninguém notaria — o razão fecharia
 * nas duas. Por isso toda gravação começa perguntando se aquele
 * documento já tem lançamento, e o segundo pedido não faz nada.
 */

const sb = () => getServerSupabase();

export type ResultadoLancamento = {
  journalId: string | null;
  /** `true` quando o documento já estava contabilizado e nada foi feito. */
  jaExistia: boolean;
  erro?: string;
};

/** Grava cabeçalho + partidas numa transação lógica. */
async function gravar(
  clientId: string,
  args: {
    entryDate: string; postingDate: string;
    // Espelha a trava de `journal.source_module` no banco (migração 030).
    sourceModule: "purchase" | "sale" | "bank" | "payroll" | "charge" | "opening" | "manual";
    documentId: string | null; documentRef?: string | null; description?: string | null;
    userId?: string | null;
  },
  linhas: PostingLine[]
): Promise<string> {
  if (somaDebito(linhas) !== somaCredito(linhas)) {
    // Rede de segurança antes do banco: o gatilho também recusa, mas aqui
    // a mensagem sabe de que documento se trata.
    throw new Error(
      `Lancamento de ${args.documentRef ?? args.documentId} nao fecha: ` +
        `debito ${somaDebito(linhas)} e credito ${somaCredito(linhas)}.`
    );
  }

  const { data: cabecalho, error: e1 } = await sb().from("journal").insert({
    client_id: clientId,
    entry_date: args.entryDate,
    posting_date: args.postingDate,
    source_module: args.sourceModule,
    document_id: args.documentId,
    document_ref: args.documentRef ?? null,
    description: args.description ?? null,
    created_by: args.userId ?? null,
  }).select("id").single();
  if (e1 || !cabecalho) throw new Error(e1?.message || "Falhou ao criar o lancamento.");

  const { error: e2 } = await sb().from("journal_lines").insert(
    linhas.map((l, i) => ({
      journal_id: cabecalho.id,
      line_no: i + 1,
      account_code: l.account_code,
      debit: l.debit,
      credit: l.credit,
      description: l.description ?? null,
      resolved_by: l.resolved_by ?? null,
      vat_rate: l.vat_rate ?? null,
      net_amount: l.net_amount ?? null,
      vat_amount: l.vat_amount ?? null,
      counterparty: l.counterparty ?? null,
      source_line_id: l.source_line_id ?? null,
    }))
  );
  if (e2) {
    // O cabeçalho já entrou; sem as partidas ele é lixo que apareceria
    // como lançamento vazio no razão.
    await sb().from("journal").delete().eq("id", cabecalho.id);
    throw new Error(e2.message);
  }
  return cabecalho.id as string;
}

const jaContabilizado = async (modulo: string, documentId: string): Promise<string | null> => {
  const { data } = await sb().from("journal")
    .select("id").eq("source_module", modulo).eq("document_id", documentId).maybeSingle();
  return (data as any)?.id ?? null;
};

/**
 * O prazo de pagamento de um fornecedor, quando não vem na nota.
 *
 * 30 dias é a praxe irlandesa para fatura comercial. É um palpite, e por
 * isso o título nasce com a data marcada como estimada — o aging fica
 * aproximado até alguém corrigir, o que é melhor do que não ter aging.
 */
const VENCIMENTO_PADRAO_DIAS = 30;
const somarDias = (iso: string, dias: number): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------- compras

export async function postInvoice(
  invoiceId: string, userId?: string | null
): Promise<ResultadoLancamento> {
  const existente = await jaContabilizado("purchase", invoiceId);
  if (existente) {
    /*
     * Documento JÁ contabilizado ainda assim garante o título.
     *
     * Sair aqui a dizer "já existe" assume que lançamento e título nascem sempre
     * juntos. Não nascem: basta o título ter falhado na primeira vez — por um
     * defeito, ou porque a integração de pagar/receber estava desligada nesse dia
     * — para o documento ficar com partida no razão e nada na lista.
     *
     * Esse estado não se corrige sozinho: contabilizar de novo salta o documento
     * exactamente por já ter lançamento, e o título nunca aparece. O sintoma é a
     * conta de controlo a não bater com o aging, sem nada no ecrã a dizer qual
     * documento falta — foi o caso da venda 010169 em 2026-08-26.
     *
     * `garantirTitulo*` é idempotente, então chamá-lo aqui não custa nada quando
     * o título já existe.
     */
    await garantirTituloDeCompra(invoiceId, existente);
    return { journalId: existente, jaExistia: true };
  }

  const { data: nota } = await sb().from("invoices")
    .select("id,client_id,supplier_name,supplier_vat,invoice_number,invoice_date,posting_date,total_gross")
    .eq("id", invoiceId).maybeSingle();
  if (!nota) return { journalId: null, jaExistia: false, erro: "Nota nao encontrada." };
  const n = nota as any;
  if (!n.client_id) return { journalId: null, jaExistia: false, erro: "Nota sem cliente." };

  const { data: itens } = await sb().from("invoice_items")
    .select("id,description,net_amount,vat_amount_on_invoice,vat_rate_on_invoice,account_code,take_credit")
    .eq("invoice_id", invoiceId);

  // A regra do fornecedor entra como SEGUNDO elo da cadeia: só vale para
  // a linha que não trouxe conta própria.
  let contaDaRegra: string | null = null;
  if (n.supplier_vat || n.supplier_name) {
    const { data: regras } = await sb().from("supplier_rules")
      .select("account_code,supplier_vat,name_match,active").eq("client_id", n.client_id).eq("active", true);
    const achou = ((regras ?? []) as any[]).find((r) =>
      (r.supplier_vat && n.supplier_vat && r.supplier_vat === n.supplier_vat) ||
      (r.name_match && n.supplier_name &&
        String(n.supplier_name).toLowerCase().includes(String(r.name_match).toLowerCase()))
    );
    contaDaRegra = achou?.account_code ?? null;
  }

  // Sem data no documento (recibo de balcão), a data contábil é a de
  // lançamento — não se inventa uma data fiscal.
  const dataDoc = n.invoice_date || n.posting_date || new Date().toISOString().slice(0, 10);
  const dataContabil = n.posting_date || dataDoc;

  try {
    const linhas = postPurchase(
      { supplier_name: n.supplier_name, invoice_number: n.invoice_number, total_gross: n.total_gross },
      ((itens ?? []) as any[]).map((i) => ({ ...i, id: i.id })),
      contaDaRegra
    );
    const journalId = await gravar(n.client_id, {
      entryDate: dataDoc, postingDate: dataContabil, sourceModule: "purchase",
      documentId: invoiceId, documentRef: refDoDocumento(n.invoice_number, invoiceId),
      description: n.supplier_name, userId,
    }, linhas);

    /*
     * O título é garantido pelo serviço próprio, e não inserido aqui.
     *
     * Ele deixou de ser filho do lançamento: nasce do DOCUMENTO, e existe
     * mesmo em cliente que não usa o módulo contábil. Ver lib/financial/titles.ts.
     * Aqui passa-se o `journalId` só para os dois ficarem ligados.
     */
    await garantirTituloDeCompra(invoiceId, journalId);
    return { journalId, jaExistia: false };
  } catch (e: any) {
    return { journalId: null, jaExistia: false, erro: e.message };
  }
}

// ----------------------------------------------------------------- vendas

export async function postSaleDoc(
  saleId: string, userId?: string | null
): Promise<ResultadoLancamento> {
  const existente = await jaContabilizado("sale", saleId);
  if (existente) {
    // Mesma razão do lado da compra — ver o comentário em `postInvoice`.
    await garantirTituloDeVenda(saleId, existente);
    return { journalId: existente, jaExistia: true };
  }

  const { data: venda } = await sb().from("sales")
    .select("id,client_id,customer,doc_number,entry_date,net_amount,vat_amount,vat_rate,account_code")
    .eq("id", saleId).maybeSingle();
  if (!venda) return { journalId: null, jaExistia: false, erro: "Venda nao encontrada." };
  const v = venda as any;
  if (!v.client_id) return { journalId: null, jaExistia: false, erro: "Venda sem cliente." };

  const data = v.entry_date || new Date().toISOString().slice(0, 10);

  /*
   * O valor da venda vem do CABEÇALHO, e as LINHAS são a rede.
   *
   * A compra sempre somou os itens (ver `postPurchase`); a venda só olhava o
   * cabeçalho. A assimetria não se via até chegar um documento com linhas
   * legíveis e cabeçalho vazio — uma nota estrangeira lida pelo telemóvel, em
   * que o leitor achou os dois itens mas não o total.
   *
   * O que acontecia então: net 0 e VAT 0, partidas todas a zero, e o banco a
   * recusar com `journal_lines_lado_check`. O documento ficava de fora do
   * razão e da lista de contas a receber, e a mensagem no ecrã era o nome de
   * uma restrição de Postgres.
   *
   * Somar as linhas quando o cabeçalho não tem valor é o mesmo princípio que
   * a compra já seguia: o documento diz o que diz, e a soma das partes é a
   * melhor fonte quando o todo falta.
   */
  let net = Number(v.net_amount) || 0;
  let vat = Number(v.vat_amount) || 0;
  if (net === 0) {
    const { data: linhasDaVenda } = await sb().from("sales_items")
      .select("net_amount,vat_amount").eq("sale_id", saleId);
    const somar = (f: (l: any) => unknown) =>
      Math.round(((linhasDaVenda ?? []) as any[])
        .reduce((t, l) => t + (Number(f(l)) || 0), 0) * 100) / 100;
    net = somar((l) => l.net_amount);
    if (vat === 0) vat = somar((l) => l.vat_amount);
  }

  // Sem valor nenhum não há venda a lançar, e é preciso dizê-lo em português
  // de gente: o erro que vinha antes era o nome de uma restrição do banco.
  if (net === 0 && vat === 0) {
    return {
      journalId: null, jaExistia: false,
      erro: "A venda esta sem valor: nem o total do documento nem as linhas dele têm importância.",
    };
  }

  try {
    const linhas = postSale({
      customer: v.customer, doc_number: v.doc_number,
      net_amount: net, vat_amount: vat, vat_rate: v.vat_rate,
      // A conta de receita da venda só entra se for de RESULTADO: o
      // `account_code` de uma venda às vezes guarda a conta do plano do
      // cliente e apontar para um passivo faria o DRE sumir.
      account_code: /^4/.test(String(v.account_code ?? "")) ? v.account_code : null,
    });
    const journalId = await gravar(v.client_id, {
      entryDate: data, postingDate: data, sourceModule: "sale",
      documentId: saleId, documentRef: refDoDocumento(v.doc_number, saleId), description: v.customer, userId,
    }, linhas);

    // Idem para o outro lado — ver o comentário em postInvoice.
    await garantirTituloDeVenda(saleId, journalId);
    return { journalId, jaExistia: false };
  } catch (e: any) {
    return { journalId: null, jaExistia: false, erro: e.message };
  }
}

// ------------------------------------------------------------------ baixa

/**
 * Baixa de título pelo banco.
 *
 * Escreve o lançamento (DR fornecedores / CR banco, ou o inverso) e a
 * linha de baixa. O título fecha sozinho — o saldo em aberto é a soma
 * das baixas, não uma coluna que alguém tem de lembrar de atualizar.
 */
export async function settle(args: {
  ledgerItemId: string; amount: number; settledOn: string;
  bankTransactionId?: string | null; bankAccountCode?: string; userId?: string | null;
}): Promise<ResultadoLancamento> {
  const { data: titulo } = await sb().from("ledger_items")
    .select("id,client_id,kind,counterparty,document_ref,account_code")
    .eq("id", args.ledgerItemId).maybeSingle();
  if (!titulo) return { journalId: null, jaExistia: false, erro: "Titulo nao encontrado." };
  const t = titulo as any;

  try {
    // A conta de controlo do TÍTULO manda, quando ele tem uma.
    const linhas = postSettlement(
      t.kind, args.amount, t.counterparty, CONTAS_PADRAO, args.bankAccountCode, t.account_code
    );
    const journalId = await gravar(t.client_id, {
      entryDate: args.settledOn, postingDate: args.settledOn, sourceModule: "bank",
      documentId: args.bankTransactionId ?? args.ledgerItemId,
      documentRef: t.document_ref, description: t.counterparty, userId: args.userId,
    }, linhas);

    const { error } = await sb().from("ledger_settlements").insert({
      ledger_item_id: args.ledgerItemId,
      bank_transaction_id: args.bankTransactionId ?? null,
      settled_on: args.settledOn, amount: Math.abs(args.amount),
      journal_id: journalId, created_by: args.userId ?? null,
    });
    if (error) {
      await sb().from("journal").delete().eq("id", journalId);
      throw new Error(error.message);
    }
    return { journalId, jaExistia: false };
  } catch (e: any) {
    return { journalId: null, jaExistia: false, erro: e.message };
  }
}

// ----------------------------------------------------- movimento do banco

/**
 * Contabiliza uma transação do banco.
 *
 * Três caminhos, e a ordem importa:
 *
 *   1. **Liquida uma nota ou uma venda** → baixa o título e escreve
 *      DR fornecedores / CR banco (ou o inverso). NÃO toca em despesa
 *      nem receita: essas já foram reconhecidas quando o documento
 *      entrou. Lançar de novo aqui é o erro que dobra o DRE, e é fácil
 *      de cometer olhando só o extrato.
 *   2. **Tem conta de resultado** (tarifa, juro, um débito direto sem
 *      nota) → vai direto ao resultado.
 *   3. **Não tem nem uma coisa nem outra** → não se inventa lançamento.
 *      Fica por contabilizar, e aparece como tal.
 *
 * Idempotente pelo id da transação, como todo o resto.
 */
export async function postBankTransaction(
  txnId: string, userId?: string | null
): Promise<ResultadoLancamento> {
  const existente = await jaContabilizado("bank", txnId);
  if (existente) return { journalId: existente, jaExistia: true };

  const { data: txn } = await sb().from("bank_transactions")
    .select("id,client_id,txn_date,description,contact_name,amount,account_code,invoice_id,sale_id")
    .eq("id", txnId).maybeSingle();
  if (!txn) return { journalId: null, jaExistia: false, erro: "Transacao nao encontrada." };
  const t = txn as any;
  const valor = Number(t.amount) || 0;
  if (!valor) return { journalId: null, jaExistia: false, erro: "Transacao sem valor." };

  const documento = t.invoice_id || t.sale_id;
  if (documento) {
    const { data: titulo } = await sb().from("ledger_items")
      .select("id").eq("client_id", t.client_id).eq("document_id", documento).maybeSingle();
    if (!titulo) {
      // Documento ainda não contabilizado: sem título não há o que baixar.
      // Contabilizar a nota primeiro resolve, e é o que o backfill faz.
      return { journalId: null, jaExistia: false, erro: "Documento ainda nao contabilizado." };
    }
    return settle({
      ledgerItemId: (titulo as any).id,
      amount: Math.abs(valor),
      settledOn: t.txn_date,
      bankTransactionId: t.id,
      userId,
    });
  }

  if (!t.account_code) {
    return { journalId: null, jaExistia: false, erro: "Transacao sem conta e sem documento." };
  }

  try {
    const linhas = postBankDirect(valor, t.account_code, t.contact_name);
    const journalId = await gravar(t.client_id, {
      entryDate: t.txn_date, postingDate: t.txn_date, sourceModule: "bank",
      documentId: t.id, documentRef: null, description: t.description, userId,
    }, linhas);
    return { journalId, jaExistia: false };
  } catch (e: any) {
    return { journalId: null, jaExistia: false, erro: e.message };
  }
}

// ------------------------------------------------- contabilização retroativa

export type ResumoBackfill = {
  notas: number; vendas: number; banco: number;
  jaEstavam: number; erros: { doc: string; erro: string }[];
  /** Títulos criados — existem mesmo com a contabilidade desligada. */
  titulos: number;
  /** Encargos que estavam sem partida no razão e passaram a ter. */
  encargos: number;
  /** Quando a contabilidade não está integrada neste cliente. */
  semContabilidade?: boolean;
  /**
   * Documentos SALTADOS por ainda não terem sido conferidos.
   *
   * Não são erro — são trabalho por fazer, e por isso contam à parte. Misturá-
   * los com os erros faria a lista de problemas crescer com coisas que não são
   * problema, e é assim que se deixa de ler a lista.
   */
  porConferir: number;
};

/**
 * Contabiliza tudo o que já está no banco e ainda não tem lançamento.
 *
 * Existe porque o motor nasceu depois dos documentos: há notas e vendas
 * de meses atrás que precisam entrar no razão para o DRE cobrir o ano
 * inteiro. Rodar de novo é seguro — o que já tem lançamento é saltado.
 *
 * Um documento que falha NÃO interrompe os outros: o erro entra no
 * resumo com o número do documento. Parar no primeiro deixaria metade
 * do razão dentro e metade fora, que é o pior estado possível.
 */
export async function backfillClient(
  clientId: string, ate?: string, userId?: string | null
): Promise<ResumoBackfill> {
  const resumo: ResumoBackfill = {
    notas: 0, vendas: 0, banco: 0, jaEstavam: 0, erros: [], titulos: 0, encargos: 0, porConferir: 0,
  };
  const limite = ate ?? new Date().toISOString().slice(0, 10);

  /*
   * O que este cliente integra decide o que acontece aqui.
   *
   * Com a contabilidade DESLIGADA não se escreve no razão — mas os títulos
   * continuam a nascer. É o cenário do cliente com pouca movimentação, que
   * quer a lista do que deve e do que tem a receber sem nada de partidas
   * dobradas. Ver lib/integrations.ts.
   */
  const integra = await integracoesDo(clientId);
  resumo.semContabilidade = !integra.documents_to_accounting;

  /*
   * SÓ o que foi conferido é que integra.
   *
   * Pedido do Alfredo em 2026-08-26, e a razão é a ordem do trabalho: integrar
   * uma leitura que ninguém olhou põe no razão e em contas a pagar um número
   * que ainda pode mudar. Quando muda, é preciso devolver o documento, corrigir
   * e integrar de novo — três passos que a conferência antes evitava.
   *
   * `reviewed_at` e não `needs_review`: "não pede revisão" quer dizer que a
   * leitura veio confiante, não que alguém a viu. A diferença entre as duas é
   * exactamente o que uma auditoria pergunta.
   */
  let qi = sb().from("invoices").select("id,invoice_number,invoice_date,reviewed_at")
    .eq("client_id", clientId).order("invoice_date", { ascending: true });
  const { data: notas } = await qi;
  for (const n of ((notas ?? []) as any[])) {
    if (n.invoice_date && n.invoice_date > limite) continue;
    if (!n.reviewed_at) { resumo.porConferir++; continue; }
    if (!integra.documents_to_accounting) {
      const t = await garantirTituloDeCompra(n.id);
      if (t.id && !t.jaExistia) resumo.titulos++;
      continue;
    }
    const r = await postInvoice(n.id, userId);
    if (r.jaExistia) resumo.jaEstavam++;
    else if (r.erro) resumo.erros.push({ doc: n.invoice_number || n.id, erro: r.erro });
    else resumo.notas++;
  }

  const { data: vendas } = await sb().from("sales").select("id,doc_number,entry_date,reviewed_at")
    .eq("client_id", clientId).order("entry_date", { ascending: true });
  for (const v of ((vendas ?? []) as any[])) {
    if (v.entry_date && v.entry_date > limite) continue;
    // Mesma regra da compra — ver o comentário acima.
    if (!v.reviewed_at) { resumo.porConferir++; continue; }
    if (!integra.documents_to_accounting) {
      const t = await garantirTituloDeVenda(v.id);
      if (t.id && !t.jaExistia) resumo.titulos++;
      continue;
    }
    const r = await postSaleDoc(v.id, userId);
    if (r.jaExistia) resumo.jaEstavam++;
    else if (r.erro) resumo.erros.push({ doc: v.doc_number || v.id, erro: r.erro });
    else resumo.vendas++;
  }

  /*
   * O banco vem POR ÚLTIMO, e não é ordem à toa: uma baixa precisa do
   * título, e o título nasce com a nota. Contabilizar o banco primeiro
   * daria "documento ainda não contabilizado" em tudo.
   */
  // Sem contabilidade não há partida bancária a escrever; e sem
  // `bank_settles_titles` o banco não dá baixa em título nenhum.
  const { data: txns } = integra.documents_to_accounting || integra.bank_settles_titles
    ? await sb().from("bank_transactions")
        .select("id,txn_date,description").eq("client_id", clientId)
        .order("txn_date", { ascending: true })
    : { data: [] as any[] };
  for (const b of ((txns ?? []) as any[])) {
    if (b.txn_date && b.txn_date > limite) continue;
    const r = await postBankTransaction(b.id, userId);
    if (r.jaExistia) resumo.jaEstavam++;
    else if (r.erro) {
      // Transação sem conta e sem documento não é erro: é movimento que
      // ninguém classificou ainda. Poluir a lista de erros com isso
      // esconderia os erros de verdade.
      if (!/sem conta e sem documento/.test(r.erro)) {
        resumo.erros.push({ doc: b.description || b.id, erro: r.erro });
      }
    } else resumo.banco++;
  }

  /*
   * Os ENCARGOS sem lançamento.
   *
   * Um juro acrescentado antes de a contabilização de encargos existir — ou
   * enquanto o cliente estava sem contabilidade integrada — aumenta o que o
   * título deve e não tem partida no razão. O efeito é uma conta de controlo
   * (fornecedores ou clientes) que não fecha, por exatamente o valor do
   * encargo, e não há nada no ecrã que aponte para a causa.
   *
   * Por isso entram aqui: contabilizar é a operação que a pessoa já usa para
   * "pôr o razão em dia", e este é um caso de razão fora de dia.
   */
  if (integra.documents_to_accounting) {
    const { data: titulos } = await sb().from("ledger_items").select("id").eq("client_id", clientId);
    const ids = ((titulos ?? []) as any[]).map((t) => t.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { data: encargos } = await sb().from("ledger_charges")
        .select("id").in("ledger_item_id", ids.slice(i, i + 200));
      for (const e of ((encargos ?? []) as any[])) {
        const r = await contabilizarEncargo(e.id, userId);
        if (r.journalId && !r.jaExistia) resumo.encargos++;
      }
    }
  }

  return resumo;
}


// ------------------------------------------------- encargos e baixa manual

/**
 * Contabiliza um encargo do título — juro, taxa, multa, despesa, desconto.
 *
 * Existe porque acrescentar dez euros de juro subia o valor em aberto no ecrã
 * e não produzia partida nenhuma: o balancete ficava a dever exatamente o que
 * o título dizia a mais, e a diferença só apareceria na conciliação, semanas
 * depois, sem ninguém saber de onde vinha.
 *
 * Idempotente pelo id do encargo. Cliente sem contabilidade integrada não
 * escreve no razão — o encargo continua a valer no título, que é o que a
 * pessoa vê e cobra.
 */
export async function contabilizarEncargo(
  chargeId: string, userId?: string | null
): Promise<ResultadoLancamento> {
  const existente = await jaContabilizado("charge", chargeId);
  if (existente) return { journalId: existente, jaExistia: true };

  const { data: encargo } = await sb().from("ledger_charges")
    .select("id,ledger_item_id,kind,amount,account_code,description,incurred_on")
    .eq("id", chargeId).maybeSingle();
  const e = encargo as any;
  if (!e) return { journalId: null, jaExistia: false, erro: "Encargo nao encontrado." };

  const { data: titulo } = await sb().from("ledger_items")
    .select("id,client_id,kind,counterparty,document_ref,account_code").eq("id", e.ledger_item_id).maybeSingle();
  const t = titulo as any;
  if (!t) return { journalId: null, jaExistia: false, erro: "Titulo nao encontrado." };

  const integra = await integracoesDo(t.client_id);
  if (!integra.documents_to_accounting) {
    return { journalId: null, jaExistia: false, erro: "Contabilidade nao integrada." };
  }

  try {
    const linhas = postCharge(
      t.kind, e.kind, Number(e.amount), e.account_code, t.counterparty, CONTAS_PADRAO, t.account_code
    );
    const journalId = await gravar(t.client_id, {
      entryDate: e.incurred_on, postingDate: e.incurred_on, sourceModule: "charge",
      documentId: chargeId, documentRef: t.document_ref,
      description: e.description || `${e.kind} — ${t.counterparty ?? ""}`.trim(), userId,
    }, linhas);
    return { journalId, jaExistia: false };
  } catch (err: any) {
    return { journalId: null, jaExistia: false, erro: err.message };
  }
}

/** Desfaz o lançamento de um encargo removido. */
export async function descontabilizarEncargo(chargeId: string): Promise<void> {
  const j = await jaContabilizado("charge", chargeId);
  if (j) await sb().from("journal").delete().eq("id", j);
}

export type ResultadoBaixa = {
  ok: boolean;
  erro?: string;
  bankTransactionId?: string;
  journalId?: string | null;
  /** Quando o cliente não integra contabilidade: baixa sim, razão não. */
  semContabilidade?: boolean;
};

/**
 * Baixa um título PELO BANCO, escolhendo a conta.
 *
 * É a operação que faltava e que o Alfredo perguntou por: "onde faço a baixa
 * selecionando a conta de banco para tirar dinheiro do banco?". Faz as três
 * coisas de uma vez, e nesta ordem:
 *
 *   1. cria o MOVIMENTO na conta bancária escolhida (o dinheiro sai/entra);
 *   2. grava a BAIXA contra o título (o saldo em aberto cai);
 *   3. escreve a PARTIDA no razão — fornecedores a banco, ou banco a clientes.
 *
 * O movimento no banco vem primeiro de propósito: é o fato do mundo real. Se o
 * razão falhar, fica um movimento por conciliar — visível e corrigível. Ao
 * contrário, ficaria um lançamento contábil de um dinheiro que nunca saiu.
 */
export async function baixarPeloBanco(args: {
  clientId: string; ledgerItemId: string; bankAccountId: string;
  settledOn: string; amount: number; userId?: string | null;
}): Promise<ResultadoBaixa> {
  const { data: titulo } = await sb().from("ledger_items_open")
    .select("id,client_id,kind,counterparty,document_ref,document_id,source_module,outstanding_amount")
    .eq("id", args.ledgerItemId).eq("client_id", args.clientId).maybeSingle();
  const t = titulo as any;
  if (!t) return { ok: false, erro: "Titulo nao encontrado." };

  const valor = Math.round(Math.abs(args.amount) * 100) / 100;
  if (valor <= 0) return { ok: false, erro: "O valor da baixa tem de ser maior que zero." };
  // Baixar mais do que se deve deixaria o título com saldo negativo e o razão
  // com dinheiro que nunca foi devido. Um centavo a mais quase sempre é engano
  // de digitação, e o resto é encargo que ainda não foi lançado.
  if (valor > Number(t.outstanding_amount) + 0.004) {
    return { ok: false, erro: `A baixa (${valor}) e maior que o saldo em aberto (${t.outstanding_amount}).` };
  }

  const { data: conta } = await sb().from("bank_accounts")
    .select("id,client_id,name,account_code").eq("id", args.bankAccountId)
    .eq("client_id", args.clientId).maybeSingle();
  const c = conta as any;
  if (!c) return { ok: false, erro: "Conta bancaria nao encontrada." };

  const pagando = t.kind === "payable";
  const { data: txn, error: eTxn } = await sb().from("bank_transactions").insert({
    bank_account_id: c.id, client_id: args.clientId, txn_date: args.settledOn,
    description: `${pagando ? "Pagamento" : "Recebimento"} ${t.document_ref ?? ""}`.trim(),
    contact_name: t.counterparty,
    // Sinal: sai negativo, entra positivo. É o que faz o saldo da conta mexer
    // para o lado certo.
    amount: pagando ? -valor : valor,
    kind: pagando ? "payment" : "receipt",
    // Liga ao documento quando ele existe, para a conciliação do extrato
    // reconhecer a linha depois.
    invoice_id: t.source_module === "purchase" ? t.document_id : null,
    sale_id: t.source_module === "sale" ? t.document_id : null,
    created_by: args.userId ?? null,
  }).select("id").single();
  if (eTxn || !txn) return { ok: false, erro: eTxn?.message || "Nao criou o movimento no banco." };
  const txnId = (txn as any).id;

  const integra = await integracoesDo(args.clientId);
  if (!integra.documents_to_accounting) {
    // Sem contabilidade integrada a baixa existe na mesma: é o cliente manual,
    // que quer saber o que deve e o que pagou sem partidas dobradas.
    const { error } = await sb().from("ledger_settlements").insert({
      ledger_item_id: args.ledgerItemId, bank_transaction_id: txnId,
      settled_on: args.settledOn, amount: valor, created_by: args.userId ?? null,
    });
    if (error) {
      // Mesmo motivo do caminho com contabilidade: movimento fabricado que
      // não vingou não fica no banco.
      await sb().from("bank_transactions").delete().eq("id", txnId);
      return { ok: false, erro: error.message };
    }
    return { ok: true, bankTransactionId: txnId, journalId: null, semContabilidade: true };
  }

  const r = await settle({
    ledgerItemId: args.ledgerItemId, amount: valor, settledOn: args.settledOn,
    bankTransactionId: txnId, bankAccountCode: c.account_code || undefined, userId: args.userId,
  });
  if (r.erro) {
    /*
     * Falhou a baixa: o movimento no banco é DESFEITO.
     *
     * O comentário no topo diz que o movimento vem primeiro porque é o fato do
     * mundo real — e isso vale para um extrato importado. Não vale para um
     * movimento que ESTA chamada acabou de fabricar e que já não corresponde a
     * nada: deixá-lo produz um pagamento fantasma no banco, que o contabilizar
     * seguinte tenta baixar outra vez e falha outra vez, para sempre. Foi
     * exatamente o que aconteceu ao testar.
     *
     * Nada mais o referencia — nasceu há microssegundos nesta função.
     */
    await sb().from("bank_transactions").delete().eq("id", txnId);
    return { ok: false, erro: r.erro };
  }
  return { ok: true, bankTransactionId: txnId, journalId: r.journalId };
}


/**
 * Troca a conta de CONTROLO de um título que já tem lançamentos.
 *
 * Sem isto, mudar a conta no ecrã deixaria as partidas antigas na conta velha
 * e as novas na conta nova: nenhuma das duas fecharia, e a diferença só
 * apareceria no balancete, sem nada a apontar a causa.
 *
 * Só o CÓDIGO da conta muda — débito e crédito ficam onde estão, então cada
 * lançamento continua balanceado. É por isso que se pode fazer com um `update`
 * cirúrgico em vez de reescrever os lançamentos.
 *
 * Atinge as três origens: o documento, cada encargo e cada baixa.
 */
export async function trocarContaDeControlo(
  titleId: string, de: string, para: string
): Promise<number> {
  if (!de || !para || de === para) return 0;

  const { data: titulo } = await sb().from("ledger_items")
    .select("id,journal_id").eq("id", titleId).maybeSingle();
  if (!titulo) return 0;

  const ids: string[] = [];
  if ((titulo as any).journal_id) ids.push((titulo as any).journal_id);

  const { data: baixas } = await sb().from("ledger_settlements")
    .select("journal_id").eq("ledger_item_id", titleId);
  ids.push(...((baixas ?? []) as any[]).map((b) => b.journal_id).filter(Boolean));

  const { data: encargos } = await sb().from("ledger_charges")
    .select("id").eq("ledger_item_id", titleId);
  const idsEncargos = ((encargos ?? []) as any[]).map((e) => e.id);
  if (idsEncargos.length) {
    const { data: jsEnc } = await sb().from("journal")
      .select("id").eq("source_module", "charge").in("document_id", idsEncargos);
    ids.push(...((jsEnc ?? []) as any[]).map((j) => j.id));
  }
  if (!ids.length) return 0;

  const { data, error } = await sb().from("journal_lines")
    .update({ account_code: para })
    .in("journal_id", ids).eq("account_code", de).select("id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).length;
}
