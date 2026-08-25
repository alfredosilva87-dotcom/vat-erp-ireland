/**
 * O balanço e o DRE, no formato do Schedule 3A.
 *
 * Arquivo puro: entra uma lista de saldos por conta, sai a estrutura do
 * relatório. Não sabe de banco nem de tela, e por isso a soma de cada
 * rubrica pode ser conferida com número na mão.
 *
 * O formato é o do **Schedule 3A do Companies Act 2014** — o que uma
 * empresa PEQUENA entrega ao CRO. O Schedule 3, de média e grande, tem
 * rubricas que os clientes destes escritórios não usam.
 *
 * A Irlanda não impõe plano de contas; impõe o formato. Por isso nada
 * aqui olha para o CÓDIGO da conta: tudo se agrupa por `report_group`.
 * Renumerar o plano inteiro não muda um relatório.
 */

export type SaldoDeConta = {
  account_code: string;
  account_name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  report_group: string;
  /** Já com o sinal da natureza: devedora positiva no débito. */
  balance: number;
};

export type LinhaDeRelatorio = {
  key: string;
  label: string;
  amount: number;
  /** Linha somada a partir de outras (lucro bruto, ativo líquido). */
  computed?: boolean;
  /** Nível de recuo — 0 é rubrica principal. */
  level?: number;
  accounts?: SaldoDeConta[];
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const somaGrupo = (saldos: SaldoDeConta[], grupo: string): number =>
  r2(saldos.filter((s) => s.report_group === grupo).reduce((a, s) => a + s.balance, 0));
const contasDo = (saldos: SaldoDeConta[], grupo: string): SaldoDeConta[] =>
  saldos.filter((s) => s.report_group === grupo && s.balance !== 0);

// ------------------------------------------------------------------- DRE

/**
 * Profit and loss account.
 *
 * Receita e despesa chegam com o sinal da natureza (receita positiva no
 * crédito, despesa positiva no débito), então o lucro é receita menos
 * despesa — sem inverter nada por aqui.
 */
export function profitAndLoss(saldos: SaldoDeConta[]): {
  lines: LinhaDeRelatorio[];
  profit: number;
} {
  const turnover = somaGrupo(saldos, "turnover");
  const cost = somaGrupo(saldos, "cost_of_sales");
  const outroRendimento = somaGrupo(saldos, "other_operating_income");
  const distribuicao = somaGrupo(saldos, "distribution_costs");
  const admin = somaGrupo(saldos, "administrative_expenses");
  const juros = somaGrupo(saldos, "interest_and_similar");
  const imposto = somaGrupo(saldos, "tax_on_profit");

  const lucroBruto = r2(turnover - cost);
  const lucroOperacional = r2(lucroBruto + outroRendimento - distribuicao - admin);
  const antesImposto = r2(lucroOperacional - juros);
  const lucro = r2(antesImposto - imposto);

  const lines: LinhaDeRelatorio[] = [
    { key: "turnover", label: "Turnover", amount: turnover, accounts: contasDo(saldos, "turnover") },
    { key: "cost_of_sales", label: "Cost of sales", amount: -cost, accounts: contasDo(saldos, "cost_of_sales") },
    { key: "gross_profit", label: "Gross profit", amount: lucroBruto, computed: true },
    { key: "other_operating_income", label: "Other operating income", amount: outroRendimento, accounts: contasDo(saldos, "other_operating_income") },
    { key: "distribution_costs", label: "Distribution costs", amount: -distribuicao, accounts: contasDo(saldos, "distribution_costs") },
    { key: "administrative_expenses", label: "Administrative expenses", amount: -admin, accounts: contasDo(saldos, "administrative_expenses") },
    { key: "operating_profit", label: "Operating profit", amount: lucroOperacional, computed: true },
    { key: "interest_and_similar", label: "Interest and similar charges", amount: -juros, accounts: contasDo(saldos, "interest_and_similar") },
    { key: "profit_before_tax", label: "Profit before taxation", amount: antesImposto, computed: true },
    { key: "tax_on_profit", label: "Tax on profit", amount: -imposto, accounts: contasDo(saldos, "tax_on_profit") },
    { key: "profit", label: "Profit for the financial year", amount: lucro, computed: true },
  ];

  // Rubrica vazia não entra: um DRE de empresa pequena com oito linhas a
  // zero esconde as três que interessam. As calculadas ficam sempre.
  return { lines: lines.filter((l) => l.computed || l.amount !== 0), profit: lucro };
}

// --------------------------------------------------------------- BALANÇO

/**
 * Balance sheet.
 *
 * O lucro entra em "Profit and loss account" junto com os lucros acumulados.
 * É isto que faz o balanço fechar durante o ano: o resultado ainda não foi
 * transferido para reservas, e ignorá-lo daria um balanço fora por exatamente
 * o valor do lucro — o erro mais comum de quem monta o relatório a partir do
 * balancete.
 *
 * O lucro que entra aqui é o ACUMULADO até à data do balanço, e não o do
 * exercício: os saldos que chegam nesta função vêm acumulados desde sempre,
 * então o património tem de vir pela mesma medida. Ver a razão por extenso em
 * `lib/accounting/query.ts`.
 */
export function balanceSheet(saldos: SaldoDeConta[], lucroAcumulado: number): {
  lines: LinhaDeRelatorio[];
  netAssets: number;
  capitalAndReserves: number;
  balances: boolean;
  difference: number;
} {
  const tangivel = somaGrupo(saldos, "fixed_assets_tangible");
  const intangivel = somaGrupo(saldos, "fixed_assets_intangible");
  const stocks = somaGrupo(saldos, "stocks");
  const debtors = somaGrupo(saldos, "debtors");
  const cash = somaGrupo(saldos, "cash");
  const dentro1Ano = somaGrupo(saldos, "creditors_within_1y");
  const apos1Ano = somaGrupo(saldos, "creditors_after_1y");
  const provisoes = somaGrupo(saldos, "provisions");
  const capital = somaGrupo(saldos, "share_capital");
  const reservas = somaGrupo(saldos, "reserves");
  const lucrosAcumulados = somaGrupo(saldos, "profit_loss_account");

  const ativoFixo = r2(tangivel + intangivel);
  const ativoCorrente = r2(stocks + debtors + cash);
  const ativoCorrenteLiquido = r2(ativoCorrente - dentro1Ano);
  const totalMenosCorrente = r2(ativoFixo + ativoCorrenteLiquido);
  const ativoLiquido = r2(totalMenosCorrente - apos1Ano - provisoes);
  const capitalEReservas = r2(capital + reservas + lucrosAcumulados + lucroAcumulado);

  const lines: LinhaDeRelatorio[] = [
    { key: "fixed_assets", label: "Fixed assets", amount: ativoFixo, computed: true },
    { key: "fixed_assets_intangible", label: "Intangible assets", amount: intangivel, level: 1, accounts: contasDo(saldos, "fixed_assets_intangible") },
    { key: "fixed_assets_tangible", label: "Tangible assets", amount: tangivel, level: 1, accounts: contasDo(saldos, "fixed_assets_tangible") },

    { key: "current_assets", label: "Current assets", amount: ativoCorrente, computed: true },
    { key: "stocks", label: "Stocks", amount: stocks, level: 1, accounts: contasDo(saldos, "stocks") },
    { key: "debtors", label: "Debtors", amount: debtors, level: 1, accounts: contasDo(saldos, "debtors") },
    { key: "cash", label: "Cash at bank and in hand", amount: cash, level: 1, accounts: contasDo(saldos, "cash") },

    { key: "creditors_within_1y", label: "Creditors: amounts falling due within one year", amount: -dentro1Ano, accounts: contasDo(saldos, "creditors_within_1y") },
    { key: "net_current_assets", label: "Net current assets", amount: ativoCorrenteLiquido, computed: true },
    { key: "total_less_current", label: "Total assets less current liabilities", amount: totalMenosCorrente, computed: true },
    { key: "creditors_after_1y", label: "Creditors: amounts falling due after more than one year", amount: -apos1Ano, accounts: contasDo(saldos, "creditors_after_1y") },
    { key: "provisions", label: "Provisions for liabilities", amount: -provisoes, accounts: contasDo(saldos, "provisions") },
    { key: "net_assets", label: "Net assets", amount: ativoLiquido, computed: true },

    { key: "share_capital", label: "Called up share capital", amount: capital, level: 1, accounts: contasDo(saldos, "share_capital") },
    { key: "reserves", label: "Other reserves", amount: reservas, level: 1, accounts: contasDo(saldos, "reserves") },
    { key: "profit_loss_account", label: "Profit and loss account", amount: r2(lucrosAcumulados + lucroAcumulado), level: 1, accounts: contasDo(saldos, "profit_loss_account") },
    { key: "capital_and_reserves", label: "Capital and reserves", amount: capitalEReservas, computed: true },
  ];

  const diferenca = r2(ativoLiquido - capitalEReservas);
  return {
    lines: lines.filter((l) => l.computed || l.amount !== 0),
    netAssets: ativoLiquido,
    capitalAndReserves: capitalEReservas,
    // Em cêntimos: comparar float com float faria um balanço perfeito
    // parecer errado por 0.0000000001.
    balances: Math.round(diferenca * 100) === 0,
    difference: diferenca,
  };
}

/**
 * A conferência que vale por todas: Ativo = Passivo + Património.
 *
 * Independente do formato do relatório — se isto não fecha, há
 * lançamento errado, e nenhum ajuste de apresentação conserta.
 */
export function checkEquation(saldos: SaldoDeConta[]): {
  assets: number; liabilities: number; equity: number; profit: number; difference: number; ok: boolean;
} {
  const porTipo = (t: string) => r2(saldos.filter((s) => s.type === t).reduce((a, s) => a + s.balance, 0));
  const assets = porTipo("asset");
  const liabilities = porTipo("liability");
  const equity = porTipo("equity");
  const profit = r2(porTipo("revenue") - porTipo("expense"));
  const difference = r2(assets - (liabilities + equity + profit));
  return { assets, liabilities, equity, profit, difference, ok: Math.round(difference * 100) === 0 };
}
