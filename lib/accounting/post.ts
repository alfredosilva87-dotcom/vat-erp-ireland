/**
 * O motor de lançamento — o tradutor de documento para partida dobrada.
 *
 * Arquivo sem NENHUM import: entra documento, sai lista de partidas. Não
 * conhece banco, nem React, nem i18n. É o que permite testar cada regra
 * contábil sozinha, com número na mão, em vez de através de uma tela.
 *
 * A regra que este arquivo existe para cumprir: **nenhum módulo inventa
 * contabilidade**. Compra, venda e banco descrevem o que aconteceu; a
 * tradução para débito e crédito mora aqui, num lugar só. No dia em que
 * a conta de VAT mudar, muda aqui — não em três telas.
 */

export type Lado = "debit" | "credit";

export type PostingLine = {
  account_code: string;
  debit: number;
  credit: number;
  description?: string;
  /** Qual elo da cadeia escolheu a conta. Ver `resolveExpenseAccount`. */
  resolved_by?: string;
  vat_rate?: number;
  net_amount?: number;
  vat_amount?: number;
  counterparty?: string;
  source_line_id?: string;
};

/**
 * As contas que o motor usa por nome de papel, não por código.
 *
 * O plano de contas é do escritório e pode ser renumerado; o motor não
 * pode ter "2100" escrito no meio da regra. Aqui os códigos entram por
 * configuração, e trocar um plano inteiro é trocar este objeto.
 */
export type ContasPadrao = {
  tradeCreditors: string;   // fornecedores
  tradeDebtors: string;     // clientes
  vatReceivable: string;    // VAT a recuperar (input)
  vatPayable: string;       // VAT a pagar (output)
  bank: string;
  revenue: string;
  expenseFallback: string;  // despesa quando a cadeia não resolveu
  rounding: string;         // diferenças de arredondamento
  wages: string;            // salários (despesa)
  payrollLiability: string; // folha a pagar (passivo)
  payeLiability: string;    // PAYE/USC/PRSI a pagar à Revenue (passivo)
};

/**
 * As contas para onde o motor lança quando ninguém escolheu outra.
 *
 * ---------------------------------------------------------------------------
 * OS CÓDIGOS SÃO OS DO PLANO DA PRÁTICA (migração 037).
 *
 * Eram os do plano de arranque — 1200, 2100, 4100 — e mudaram com ele. As
 * contas antigas não foram apagadas, ficaram INATIVAS, e as partidas que já
 * existiam foram levadas para os códigos novos pela mesma migração.
 *
 * Se alguma destas deixar de existir no plano, o lançamento rebenta contra a
 * chave estrangeira em vez de escrever para o vazio — que é o que se quer:
 * um erro alto vale mais do que uma partida órfã.
 * ---------------------------------------------------------------------------
 */
export const CONTAS_PADRAO: ContasPadrao = {
  // Os CONTROLOS, e não as contas de detalhe: é neles que o razão bate com o
  // aging. `812`/`711` são "Purchase/Sales ledger control".
  tradeCreditors: "812",
  tradeDebtors: "711",
  vatReceivable: "736",   // VAT repayable (activo)
  vatPayable: "845",      // VAT control account (passivo)
  bank: "771",            // Bank current account
  revenue: "001",         // Sales
  expenseFallback: "381", // General expenses
  rounding: "999",        // Balance sheet suspense
  wages: "301",           // Wages and salaries
  payrollLiability: "871",// Wages and salaries control
  /*
   * O imposto da folha vai TODO para a 846, e não repartido pela 846 e 848.
   *
   * O plano da prática (migração 037) tem duas contas: `846 PAYE control` e
   * `848 NIC (UK) PRSI (Ireland) control`. Contabilmente seriam duas; do banco,
   * porém, sai UMA transferência para a Revenue, que cobre PAYE, USC e os dois
   * PRSI de uma vez. E um título tem uma única conta de controlo.
   *
   * Reparti-lo dava dois títulos que nenhum movimento bancário fecha — que é o
   * mesmo defeito do título de bruto que este trabalho veio corrigir. Fica um
   * só, na conta que a baixa vai debitar quando o pagamento aparecer no extrato.
   */
  payeLiability: "846",   // PAYE control account
};

/** Dinheiro em cêntimos inteiros — ver `arredondar`. */
const cents = (v: unknown): number => Math.round((Number(v) || 0) * 100);
const euros = (c: number): number => c / 100;

/**
 * Arredonda para duas casas UMA vez, no fim.
 *
 * Somar valores já arredondados e arredondar de novo é como o cêntimo
 * se perde: três linhas de €33,333 dão €99,99 e a nota diz €100,00. Por
 * isso a conta corre em cêntimos inteiros e só volta a euro na saída —
 * e o que sobrar vai para a conta de diferenças, à vista, em vez de
 * desbalancear o lançamento.
 */
export const arredondar = (v: number): number => Math.round(v * 100) / 100;

// ------------------------------------------------------- a cadeia de contas

export type Resolucao = { code: string; resolvedBy: "item" | "supplier_rule" | "default" };

/**
 * Qual conta de despesa recebe esta linha.
 *
 * A ordem é a que o escritório já usa hoje na classificação, e a mesma
 * ideia de "cadeia de busca" que ERPs grandes usam: o primeiro elo que
 * responder, vale.
 *
 *   1. a conta que a linha da nota já carrega (veio da classificação,
 *      que aprende com o uso)
 *   2. a regra do fornecedor
 *   3. a conta de despesa genérica
 *
 * O elo que respondeu volta junto e é gravado na partida. Sem isso, a
 * pergunta "por que esta nota foi para esta conta" não tem resposta — e
 * é a primeira que o contador faz quando o DRE surpreende.
 */
export function resolveExpenseAccount(
  contaDaLinha: string | null | undefined,
  contaDaRegraDoFornecedor: string | null | undefined,
  contas: ContasPadrao = CONTAS_PADRAO
): Resolucao {
  if (contaDaLinha && contaDaLinha.trim()) return { code: contaDaLinha.trim(), resolvedBy: "item" };
  if (contaDaRegraDoFornecedor && contaDaRegraDoFornecedor.trim())
    return { code: contaDaRegraDoFornecedor.trim(), resolvedBy: "supplier_rule" };
  return { code: contas.expenseFallback, resolvedBy: "default" };
}

// ------------------------------------------------------------ nota de compra

export type ItemDeCompra = {
  id?: string;
  description?: string | null;
  net_amount?: number | string | null;
  vat_amount_on_invoice?: number | string | null;
  vat_rate_on_invoice?: number | string | null;
  account_code?: string | null;
  /**
   * O VAT desta linha é recuperável?
   *
   * Na Irlanda nem todo VAT de compra volta — refeição, representação e
   * certos veículos não dão crédito. Quando não dá, o imposto NÃO vai
   * para "VAT a recuperar": ele é custo, e soma à despesa. Tratar tudo
   * como recuperável inflaria o ativo e o crédito de VAT do cliente, que
   * é o tipo de erro que a Revenue encontra e cobra.
   */
  take_credit?: boolean | null;
};

export type NotaDeCompra = {
  supplier_name?: string | null;
  invoice_number?: string | null;
  total_gross?: number | string | null;
};

/**
 * Nota de compra → despesa + VAT a recuperar + fornecedores.
 *
 * O crédito de fornecedores é o BRUTO DA NOTA quando ele existe, e não a
 * soma das linhas: é o valor que a empresa deve, e é ele que tem de bater
 * com o título e com o pagamento no banco. Se as linhas não somarem o
 * bruto — arredondamento do fornecedor, linha faltando na extração — a
 * diferença aparece na conta de diferenças, visível, em vez de o
 * lançamento não fechar.
 */
export function postPurchase(
  nota: NotaDeCompra,
  itens: ItemDeCompra[],
  contaDaRegraDoFornecedor?: string | null,
  contas: ContasPadrao = CONTAS_PADRAO
): PostingLine[] {
  const linhas: PostingLine[] = [];
  const fornecedor = nota.supplier_name ?? null;

  // Agrupa por conta: dez linhas de café na mesma conta viram uma
  // partida. O razão é para ler; o detalhe está na nota.
  const porConta = new Map<string, { debito: number; resolvedBy: string; net: number; vat: number }>();

  for (const item of itens) {
    const net = cents(item.net_amount);
    const vat = cents(item.vat_amount_on_invoice);
    const r = resolveExpenseAccount(item.account_code, contaDaRegraDoFornecedor, contas);
    // VAT não recuperável entra no custo, junto da despesa.
    const recuperavel = item.take_credit !== false;
    const debitoDespesa = net + (recuperavel ? 0 : vat);

    const atual = porConta.get(r.code) ?? { debito: 0, resolvedBy: r.resolvedBy, net: 0, vat: 0 };
    atual.debito += debitoDespesa;
    atual.net += net;
    atual.vat += recuperavel ? 0 : vat;
    porConta.set(r.code, atual);

    if (recuperavel && vat !== 0) {
      const v = porConta.get("__vat__") ?? { debito: 0, resolvedBy: "vat", net: 0, vat: 0 };
      v.debito += vat;
      v.vat += vat;
      porConta.set("__vat__", v);
    }
  }

  for (const [code, v] of porConta) {
    if (code === "__vat__") continue;
    if (v.debito === 0) continue;
    linhas.push({
      account_code: code,
      debit: euros(v.debito),
      credit: 0,
      resolved_by: v.resolvedBy,
      net_amount: euros(v.net),
      vat_amount: euros(v.vat),
      counterparty: fornecedor ?? undefined,
      description: nota.invoice_number ? `${fornecedor ?? ""} ${nota.invoice_number}`.trim() : fornecedor ?? undefined,
    });
  }

  const vatRecuperavel = porConta.get("__vat__")?.debito ?? 0;
  if (vatRecuperavel !== 0) {
    linhas.push({
      account_code: contas.vatReceivable,
      debit: euros(vatRecuperavel),
      credit: 0,
      resolved_by: "vat",
      vat_amount: euros(vatRecuperavel),
      counterparty: fornecedor ?? undefined,
    });
  }

  const bruto = cents(nota.total_gross) || linhas.reduce((s, l) => s + cents(l.debit), 0);
  linhas.push({
    account_code: contas.tradeCreditors,
    debit: 0,
    credit: euros(bruto),
    resolved_by: "rule",
    counterparty: fornecedor ?? undefined,
    description: nota.invoice_number ?? undefined,
  });

  return fecharComDiferenca(linhas, contas);
}

// ------------------------------------------------------------------- venda

export type Venda = {
  customer?: string | null;
  doc_number?: string | null;
  net_amount?: number | string | null;
  vat_amount?: number | string | null;
  vat_rate?: number | string | null;
  account_code?: string | null;
};

/** Venda → clientes a receber (bruto) contra receita (líquido) e VAT a pagar. */
export function postSale(venda: Venda, contas: ContasPadrao = CONTAS_PADRAO): PostingLine[] {
  const net = cents(venda.net_amount);
  const vat = cents(venda.vat_amount);
  const cliente = venda.customer ?? null;
  const receita = venda.account_code?.trim() || contas.revenue;

  const linhas: PostingLine[] = [
    {
      account_code: contas.tradeDebtors,
      debit: euros(net + vat),
      credit: 0,
      resolved_by: "rule",
      counterparty: cliente ?? undefined,
      description: venda.doc_number ?? undefined,
    },
    {
      account_code: receita,
      debit: 0,
      credit: euros(net),
      resolved_by: venda.account_code ? "item" : "default",
      net_amount: euros(net),
      counterparty: cliente ?? undefined,
    },
  ];

  if (vat !== 0) {
    linhas.push({
      account_code: contas.vatPayable,
      debit: 0,
      credit: euros(vat),
      resolved_by: "vat",
      vat_amount: euros(vat),
      vat_rate: venda.vat_rate != null ? Number(venda.vat_rate) : undefined,
      counterparty: cliente ?? undefined,
    });
  }

  return fecharComDiferenca(linhas, contas);
}

// ------------------------------------------------------------------- baixa

/**
 * Baixa: o dinheiro que sai ou entra pelo banco fecha o título.
 *
 * `payable` → débito fornecedores, crédito banco (a dívida diminui).
 * `receivable` → débito banco, crédito clientes (o direito diminui).
 *
 * Não mexe em despesa nem em receita: essas já foram reconhecidas na
 * nota. Lançar despesa de novo no pagamento é o erro que dobra o DRE —
 * e é fácil de cometer quando se olha só o extrato do banco.
 */
/**
 * O lançamento de um ENCARGO do título — juro, taxa, multa, despesa, desconto.
 *
 * Faltava, e a falta era visível: acrescentava-se dez euros de juro a uma
 * conta a pagar, o valor em aberto subia na tela, e no razão não acontecia
 * nada. O balancete ficava a dever exatamente o que o título dizia a mais.
 *
 * A partida é simples e é sempre a mesma ideia: o encargo aumenta o que se
 * deve (ou o que se tem a receber) e nasce contra uma conta de resultado.
 *
 *   pagar   + juro      →  DR juros            CR fornecedores
 *   pagar   + desconto  →  DR fornecedores     CR outro rendimento
 *   receber + juro      →  DR clientes         CR outro rendimento
 *   receber + desconto  →  DR desconto/despesa CR clientes
 *
 * O desconto é o espelho de propósito: ele ABATE, e um desconto lançado como
 * se fosse juro faria a dívida crescer no razão enquanto encolhe na tela.
 */
export function postCharge(
  tipoDoTitulo: "payable" | "receivable",
  tipoDoEncargo: "interest" | "fee" | "penalty" | "other" | "discount",
  valor: number,
  contaDoEncargo?: string | null,
  contraparte?: string | null,
  contas: ContasPadrao = CONTAS_PADRAO,
  /**
   * A conta de controlo DO TÍTULO, quando ele tem uma própria.
   *
   * Existe porque o campo "Conta contábil" do título gravava e não era lido
   * por ninguém: escolhesse-se o que se escolhesse, a partida ia para 2100 ou
   * 1200. Um campo que aceita e ignora é pior do que um campo que não existe.
   */
  contaDeControlo?: string | null
): PostingLine[] {
  const v = arredondar(Math.abs(valor));
  const controlo = (contaDeControlo && contaDeControlo.trim())
    || (tipoDoTitulo === "payable" ? contas.tradeCreditors : contas.tradeDebtors);
  const desconto = tipoDoEncargo === "discount";
  // Sem conta escolhida: despesa cai no vala-comum de despesas, ganho cai em
  // outro rendimento. Melhor uma conta previsível do que recusar o lançamento.
  const resultado = (contaDoEncargo && contaDoEncargo.trim())
    || (desconto === (tipoDoTitulo === "payable") ? contas.revenue : contas.expenseFallback);

  const cp = contraparte ?? undefined;
  const aumenta = !desconto;

  if (tipoDoTitulo === "payable") {
    return aumenta
      ? [{ account_code: resultado, debit: v, credit: 0, resolved_by: "rule", counterparty: cp },
         { account_code: controlo, debit: 0, credit: v, resolved_by: "rule", counterparty: cp }]
      : [{ account_code: controlo, debit: v, credit: 0, resolved_by: "rule", counterparty: cp },
         { account_code: resultado, debit: 0, credit: v, resolved_by: "rule", counterparty: cp }];
  }
  return aumenta
    ? [{ account_code: controlo, debit: v, credit: 0, resolved_by: "rule", counterparty: cp },
       { account_code: resultado, debit: 0, credit: v, resolved_by: "rule", counterparty: cp }]
    : [{ account_code: resultado, debit: v, credit: 0, resolved_by: "rule", counterparty: cp },
       { account_code: controlo, debit: 0, credit: v, resolved_by: "rule", counterparty: cp }];
}

export function postSettlement(
  tipo: "payable" | "receivable",
  valor: number,
  contraparte?: string | null,
  contas: ContasPadrao = CONTAS_PADRAO,
  contaBanco?: string,
  /** A conta de controlo do título — ver `postCharge`. */
  contaDeControlo?: string | null
): PostingLine[] {
  const v = arredondar(Math.abs(valor));
  const banco = contaBanco || contas.bank;
  const controlo = (contaDeControlo && contaDeControlo.trim())
    || (tipo === "payable" ? contas.tradeCreditors : contas.tradeDebtors);
  if (tipo === "payable") {
    return [
      { account_code: controlo, debit: v, credit: 0, resolved_by: "rule", counterparty: contraparte ?? undefined },
      { account_code: banco, debit: 0, credit: v, resolved_by: "rule", counterparty: contraparte ?? undefined },
    ];
  }
  return [
    { account_code: banco, debit: v, credit: 0, resolved_by: "rule", counterparty: contraparte ?? undefined },
    { account_code: controlo, debit: 0, credit: v, resolved_by: "rule", counterparty: contraparte ?? undefined },
  ];
}

/**
 * Movimento de banco que NÃO é baixa de título — tarifa, juro, um débito
 * direto sem nota. Vai direto ao resultado.
 *
 * `kind` diz o sentido pelo sinal do valor no extrato: saída é despesa,
 * entrada é receita (ou estorno).
 */
export function postBankDirect(
  valor: number,
  contaResultado: string,
  contraparte?: string | null,
  contas: ContasPadrao = CONTAS_PADRAO,
  contaBanco?: string
): PostingLine[] {
  const v = arredondar(Math.abs(valor));
  const banco = contaBanco || contas.bank;
  // Valor negativo no extrato é dinheiro saindo.
  const saida = valor < 0;
  return saida
    ? [
        { account_code: contaResultado, debit: v, credit: 0, resolved_by: "bank_rule", counterparty: contraparte ?? undefined },
        { account_code: banco, debit: 0, credit: v, resolved_by: "rule", counterparty: contraparte ?? undefined },
      ]
    : [
        { account_code: banco, debit: v, credit: 0, resolved_by: "rule", counterparty: contraparte ?? undefined },
        { account_code: contaResultado, debit: 0, credit: v, resolved_by: "bank_rule", counterparty: contraparte ?? undefined },
      ];
}

// --------------------------------------------------------------- fechamento

export const somaDebito = (l: PostingLine[]): number => arredondar(l.reduce((s, x) => s + (x.debit || 0), 0));
export const somaCredito = (l: PostingLine[]): number => arredondar(l.reduce((s, x) => s + (x.credit || 0), 0));
export const balanceado = (l: PostingLine[]): boolean => cents(somaDebito(l)) === cents(somaCredito(l));

/**
 * Fecha o lançamento jogando a sobra na conta de diferenças.
 *
 * A diferença aparece quando o bruto da nota não é exatamente a soma das
 * linhas — arredondamento do fornecedor, ou uma linha que a extração não
 * leu. Um cêntimo assim não pode impedir a nota de ser contabilizada,
 * mas também não pode sumir: fica numa conta própria, e saldo crescendo
 * ali é sintoma de regra errada, não de arredondamento.
 *
 * O teto de um euro é deliberado: acima disso não é arredondamento, é
 * erro — e erro tem de estourar, não ser absorvido em silêncio.
 */
export const TETO_DIFERENCA = 1.0;

export function fecharComDiferenca(
  linhas: PostingLine[],
  contas: ContasPadrao = CONTAS_PADRAO
): PostingLine[] {
  const dif = cents(somaDebito(linhas)) - cents(somaCredito(linhas));
  if (dif === 0) return linhas;
  if (Math.abs(dif) > cents(TETO_DIFERENCA)) {
    throw new Error(
      `Lancamento fora de balanco em ${euros(dif).toFixed(2)} — acima do teto de arredondamento. ` +
        `Confira os valores do documento antes de contabilizar.`
    );
  }
  // Débito a mais → a sobra entra como crédito na conta de diferenças.
  return [
    ...linhas,
    {
      account_code: contas.rounding,
      debit: dif < 0 ? euros(-dif) : 0,
      credit: dif > 0 ? euros(dif) : 0,
      resolved_by: "rounding",
      description: "Diferenca de arredondamento",
    },
  ];
}

// -------------------------------------------------------------------- folha

/**
 * A provisão da folha: o salário vira despesa e dívida no mesmo lançamento.
 *
 * ---------------------------------------------------------------------------
 * O QUE FALTAVA, E O ESTRAGO QUE FAZIA
 *
 * O módulo de RH abria o título da folha em contas a pagar e **nunca escrevia
 * no razão**. `journal.source_module` aceitava `'payroll'` desde a migração
 * 020 e nenhum caminho de código o usava.
 *
 * Daí decorriam três coisas, e nenhuma se via no ecrã:
 *
 *   1. Quando a folha era paga pelo banco, a baixa usava a conta de controlo
 *      do título — DR 2400 / CR banco — contra um 2400 que **nunca tinha sido
 *      creditado**. A conta de passivo ficava com saldo DEVEDOR, entrando no
 *      balanço a reduzir os credores.
 *   2. O salário nunca entrava no DRE. O lucro ficava sobrevalorizado pelo
 *      bruto da folha, todos os períodos.
 *   3. A conciliação da conta de controlo acusava uma diferença permanente:
 *      antes de pagar, aging sem razão; depois de pagar, razão sem aging.
 *      Nunca zero, e o ecrã foi feito para essa diferença significar erro.
 *
 * O balanço continuava a fechar, porque a baixa está balanceada. É por isso
 * que passou despercebido.
 * ---------------------------------------------------------------------------
 *
 * `DR salários / CR folha a pagar`, pelo bruto. É a provisão: reconhece o
 * custo no período em que o trabalho aconteceu e a dívida que dele nasce.
 * A baixa posterior consome essa dívida, e aí o 2400 volta a zero — que é
 * exactamente o que dele se espera.
 */
export function postPayroll(
  bruto: number,
  descricao?: string | null,
  contas: ContasPadrao = CONTAS_PADRAO,
  /** Conta de despesa própria, quando o escritório separa por tipo de folha. */
  contaDeDespesa?: string | null
): PostingLine[] {
  const v = arredondar(Math.abs(bruto));
  const despesa = (contaDeDespesa && contaDeDespesa.trim()) || contas.wages;
  return [
    { account_code: despesa, debit: v, credit: 0, resolved_by: "payroll",
      description: descricao ?? undefined },
    { account_code: contas.payrollLiability, debit: 0, credit: v, resolved_by: "payroll",
      description: descricao ?? undefined },
  ];
}

// ------------------------------------------------------------ titulo manual

/**
 * Um título que NÃO nasce de documento: taxa, encargo, imposto, uma conta que
 * chegou por carta e não tem nota fiscal nenhuma por trás.
 *
 * ---------------------------------------------------------------------------
 * POR QUE FALTAVA, E POR QUE IMPORTA
 *
 * Contas a pagar e a receber só sabiam nascer de uma nota de compra ou de uma
 * venda. Mas há dívida que não vem de documento fiscal: a taxa do CRO, o
 * seguro pago por débito directo, uma multa da Revenue, um acerto com o
 * fornecedor. Sem lugar para as pôr, ou ficavam fora da lista — e aí "quanto
 * devo" mente por omissão — ou alguém inventava uma nota de compra falsa para
 * as acomodar, que é pior: entra na apuração de VAT como se fosse compra.
 * ---------------------------------------------------------------------------
 *
 * A partida é a mesma ideia do encargo, sem o título por cima:
 *
 *   pagar   →  DR conta de resultado    CR conta de controlo (2100)
 *   receber →  DR conta de controlo     CR conta de resultado (1200 / receita)
 *
 * Não passa por VAT de propósito. Um título manual é o valor que se deve ou
 * se tem a receber; se houver imposto a apurar, isso vem de um documento e
 * o documento é que tem de entrar.
 */
export function postManualTitle(
  tipo: "payable" | "receivable",
  valor: number,
  contaDeResultado: string,
  contraparte?: string | null,
  descricao?: string | null,
  contas: ContasPadrao = CONTAS_PADRAO,
  /** Conta de controlo própria do título, quando ele tem uma. */
  contaDeControlo?: string | null
): PostingLine[] {
  const v = arredondar(Math.abs(valor));
  const controlo = (contaDeControlo && contaDeControlo.trim())
    || (tipo === "payable" ? contas.tradeCreditors : contas.tradeDebtors);
  const resultado = (contaDeResultado && contaDeResultado.trim())
    || (tipo === "payable" ? contas.expenseFallback : contas.revenue);
  const cp = contraparte ?? undefined;
  const d = descricao ?? undefined;

  return tipo === "payable"
    ? [
        { account_code: resultado, debit: v, credit: 0, resolved_by: "manual", counterparty: cp, description: d },
        { account_code: controlo, debit: 0, credit: v, resolved_by: "manual", counterparty: cp, description: d },
      ]
    : [
        { account_code: controlo, debit: v, credit: 0, resolved_by: "manual", counterparty: cp, description: d },
        { account_code: resultado, debit: 0, credit: v, resolved_by: "manual", counterparty: cp, description: d },
      ];
}
