/**
 * Le o Trial Balance da pratica e produz o plano de contas em JSON.
 *
 * O ficheiro traz SECCOES (Sales, Cost of Sales, Debtors, ...) e, debaixo de
 * cada uma, as contas. E a seccao que diz onde a conta entra nas demonstracoes
 * — o `report_group` do sistema — entao a leitura tem de as seguir por ordem,
 * e nao so apanhar os codigos.
 */
const XLSX = require("xlsx");

/** Seccao do ficheiro -> grupo estatutario do sistema (Schedule 3A). */
const GRUPOS = {
  "Sales": ["revenue", "turnover"],
  "Cost of Sales": ["expense", "cost_of_sales"],
  "Distribution Costs": ["expense", "distribution_costs"],
  "Administrative Expenses": ["expense", "administrative_expenses"],
  "Exceptional provisions": ["expense", "administrative_expenses"],
  "Other Income": ["revenue", "other_operating_income"],
  "Other exceptional items": ["expense", "administrative_expenses"],
  "Profit/loss on disposal of fixed assets": ["expense", "administrative_expenses"],
  "Fundamental reorganisation costs": ["expense", "administrative_expenses"],
  "Disposal of discontinued operations": ["expense", "administrative_expenses"],
  "Provision for discontinued operations": ["expense", "administrative_expenses"],
  "Bank Interest Income": ["revenue", "interest_and_similar"],
  "Investment Income": ["revenue", "interest_and_similar"],
  "Interest Payable": ["expense", "interest_and_similar"],
  "Other gains and losses": ["expense", "interest_and_similar"],
  "Investment write-offs": ["expense", "interest_and_similar"],
  "Profit and Loss Suspense": ["expense", "administrative_expenses"],
  "Tax": ["expense", "tax_on_profit"],
  "Minority interests in profit": ["expense", "tax_on_profit"],
  "Intangible Fixed Assets": ["asset", "fixed_assets_intangible"],
  "Tangible Fixed Assets": ["asset", "fixed_assets_tangible"],
  // A Schedule 3A chama-lhes "Financial assets" e poe-nos com os activos fixos.
  // O relatorio ganhou a linha para eles — ver lib/accounting/reports.ts.
  "Fixed Asset Investments": ["asset", "fixed_assets_investments"],
  "Stock": ["asset", "stocks"],
  "Debtors": ["asset", "debtors"],
  "Current Asset Investments": ["asset", "debtors"],
  "Bank and Cash Accounts": ["asset", "cash"],
  "Client Bank Accounts": ["asset", "cash"],
  "Current Liabilities": ["liability", "creditors_within_1y"],
  "Long Term Liabilities": ["liability", "creditors_after_1y"],
  "Provisions": ["liability", "provisions"],
  "Deferred Income": ["liability", "creditors_within_1y"],
  "Defined benefit pension asset": ["asset", "debtors"],
  "Balance Sheet Suspense": ["asset", "debtors"],
  "Share Capital": ["equity", "share_capital"],
  "Share Premium": ["equity", "share_capital"],
  // O relatorio tem UMA linha de "Other reserves"; as reservas todas caem la.
  // Grupos que o relatorio nao conhece nao aparecem em lado nenhum — uma conta
  // com saldo desaparecia do balanco sem erro nenhum.
  "Revaluation Reserve": ["equity", "reserves"],
  "Sinking fund": ["equity", "reserves"],
  "Capital conversion reserve fund": ["equity", "reserves"],
  "Other reserves": ["equity", "reserves"],
  "Revaluation reserve": ["equity", "reserves"],
  "Capital contribution reserve": ["equity", "reserves"],
  "Profit and Loss Account": ["equity", "profit_loss_account"],
  "Minority interests": ["equity", "reserves"],
};

/** Linhas que sao TOTAIS do relatorio, e nao contas. */
const TOTAIS = new Set([
  "Gross Profit", "Gross Profit %", "Operating Profit", "Net Profit %",
  "Profit on ordinary activities before interest", "Profit for the year after taxation",
  "Profit for the year", "Fixed Assets", "Current Assets", "Net Current Assets",
  "Total Assets less Current Liabilities", "Net Assets", "Capital and Reserves",
  "Shareholders Funds", "Profit and Loss", "Balance Sheet",
]);

function extrair(ficheiro) {
  const wb = XLSX.readFile(ficheiro);
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
  const contas = [];
  const semGrupo = new Set();
  let seccao = null;

  for (const l of linhas) {
    const c = String(l[0] ?? "").trim();
    const d = String(l[1] ?? "").trim();
    if (!c && !d) continue;
    if (c === "Code" || c === "Date Range") continue;

    // Um titulo de seccao vem na coluna do codigo, sem numero.
    if (c && !/^\d/.test(c)) {
      if (!TOTAIS.has(c) && GRUPOS[c]) seccao = c;
      else if (GRUPOS[c]) seccao = c;
      continue;
    }
    // Linhas de total vem na coluna da descricao, sem codigo.
    if (!c && d) continue;

    if (!seccao) continue;
    const g = GRUPOS[seccao];
    if (!g) { semGrupo.add(seccao); continue; }

    contas.push({
      code: c,
      description: d || c,
      type: g[0],
      report_group: g[1],
      /*
       * O sufixo `.01` NAO faz de `001` um agrupador.
       *
       * Comecei por tratar assim — conta com filhos nao e lancavel — e estava
       * errado. A prova esta em `771 Bank current account` e `771.01 Bank
       * current account 2`: sao DUAS contas bancarias, nao um pai e um filho.
       * O mesmo em `001 Sales` / `001.01 Sales type B`, que sao sub-tipos de
       * venda e nao um total.
       *
       * `parent_code` fica so como pista de arrumacao no ecra; TODAS se lancam.
       */
      parent_code: c.includes(".") ? c.split(".")[0] : null,
    });
  }

  for (const c of contas) c.postable = true;

  return { contas, semGrupo: [...semGrupo] };
}

if (require.main === module) {
  const r = extrair(process.argv[2]);
  if (r.semGrupo.length) console.error("SEM GRUPO:", r.semGrupo);
  console.log(JSON.stringify(r.contas, null, 0));
}
module.exports = { extrair };
