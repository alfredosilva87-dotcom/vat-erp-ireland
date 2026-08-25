/**
 * As três empresas de DEMONSTRAÇÃO e o feitio de cada uma.
 *
 * Tudo aqui é INVENTADO — nome, CRO, VAT number, pessoa de contacto. Nenhum
 * dado de cliente real do escritório entra neste ficheiro, que é commitado num
 * repositório público. Ver `vat-erp-limpar-clientes-antes-do-commit`.
 *
 * São três, e não uma, porque comparar exige mais de uma curva. Os feitios são
 * escolhidos para cobrir o que um comparativo mal montado mostra ao contrário:
 *
 *   Ardmore  → cresce, e a margem melhora
 *   Bantry   → fatura mais e ganha menos: o custo sobe mais depressa
 *   Clonmel  → encolhe, e ainda paga juros de empréstimo
 *
 * Usado por `scripts/seed-demo-clients.js`.
 */

/** 2024 e 2025 fechados; 2026 corre até hoje. */
const ANOS = [2024, 2025, 2026];

const PERFIS = [
  {
    code: "DEMO-ARD",
    name: "Ardmore Print & Design Ltd",
    cro: "512334",
    vat_number: "IE9812345K",
    revenue_number: "9812345K",
    employer_number: "9812345KH",
    contact_person: "Niamh Doherty",
    email: "accounts@ardmoreprint.demo",
    phone: "+353 21 555 0132",
    address: "14 Bridge Street, Youghal, Co. Cork",
    activity_label: "Printing and design services",
    /** Receita mensal do primeiro ano, e o que ela faz nos seguintes. */
    receita: 15000,
    fatores: [1, 1.12, 1.25],
    custoRatio: [0.4, 0.38, 0.36],
    contaReceita: "4200",
    abertura: { banco: 19600, clientes: 8400, fixo: 24000, stock: 2800, fornecedores: 6300, emprestimo: 0, capital: 100 },
    salarioMes: 4700,
    juros: 0,
    funcionarios: [
      { code: "ARD01", first_name: "Sean", surname: "Kavanagh", pay_type: "Hourly", hourly_rate: 16.5, freq_type: "weekly" },
      { code: "ARD02", first_name: "Grace", surname: "Fitzgerald", pay_type: "Monthly", fixed_amount: 3100, freq_type: "monthly" },
      { code: "ARD03", first_name: "Tomasz", surname: "Nowak", pay_type: "Hourly", hourly_rate: 14.2, freq_type: "weekly" },
    ],
  },
  {
    code: "DEMO-BAN",
    name: "Bantry Bay Foods Ltd",
    cro: "487901",
    vat_number: "IE7745120T",
    revenue_number: "7745120T",
    employer_number: "7745120TH",
    contact_person: "Cormac O'Sullivan",
    email: "office@bantrybayfoods.demo",
    phone: "+353 27 555 0088",
    address: "Unit 6, Harbour Road, Bantry, Co. Cork",
    activity_label: "Wholesale and retail of foodstuffs",
    receita: 39000,
    fatores: [1, 1.05, 1.09],
    // O custo sobe mais depressa do que a receita: fatura mais, ganha menos.
    custoRatio: [0.68, 0.71, 0.76],
    contaReceita: "4100",
    abertura: { banco: 17200, clientes: 22800, fixo: 39000, stock: 18400, fornecedores: 26100, emprestimo: 14000, capital: 100 },
    salarioMes: 8600,
    juros: 0,
    funcionarios: [
      { code: "BAN01", first_name: "Aoife", surname: "Murphy", pay_type: "Monthly", fixed_amount: 3400, freq_type: "monthly" },
      { code: "BAN02", first_name: "Lukasz", surname: "Wojcik", pay_type: "Hourly", hourly_rate: 15.1, freq_type: "weekly" },
      { code: "BAN03", first_name: "Marie", surname: "Claire Byrne", pay_type: "Hourly", hourly_rate: 13.9, freq_type: "weekly" },
      { code: "BAN04", first_name: "Declan", surname: "Walsh", pay_type: "Hourly", hourly_rate: 17.8, freq_type: "weekly" },
    ],
  },
  {
    code: "DEMO-CLO",
    name: "Clonmel Logistics Ltd",
    cro: "534772",
    vat_number: "IE6620418W",
    revenue_number: "6620418W",
    employer_number: "6620418WH",
    contact_person: "Padraig Hennessy",
    email: "finance@clonmellogistics.demo",
    phone: "+353 52 555 0210",
    address: "Ard Gaoithe Business Park, Clonmel, Co. Tipperary",
    activity_label: "Road haulage and warehousing",
    // Encolhe: é o caso que um comparativo mal montado mostra ao contrário.
    receita: 34000,
    fatores: [1, 0.97, 0.92],
    custoRatio: [0.52, 0.55, 0.58],
    contaReceita: "4200",
    abertura: { banco: 15800, clientes: 29400, fixo: 92000, stock: 0, fornecedores: 20300, emprestimo: 52000, capital: 100 },
    salarioMes: 7100,
    juros: 340,
    funcionarios: [
      { code: "CLO01", first_name: "Martin", surname: "Ryan", pay_type: "Monthly", fixed_amount: 3600, freq_type: "monthly" },
      { code: "CLO02", first_name: "Eoin", surname: "Brennan", pay_type: "Hourly", hourly_rate: 18.4, freq_type: "weekly" },
      { code: "CLO03", first_name: "Ana", surname: "Silva", pay_type: "Fortnightly", fixed_amount: 1900, freq_type: "fortnightly" },
    ],
  },
];

/**
 * As despesas de estrutura, por mês.
 *
 * `credito: false` é a regra irlandesa: refeição e representação NÃO recuperam
 * VAT — o imposto delas vira custo. Papelaria e combustível recuperam. É a
 * mesma regra já aplicada aos documentos do A1 Test Ltd.
 */
const DESPESAS = [
  { conta: "6100", nome: "Rent and rates", fornecedor: "Harbour Property Management", base: 1450, taxa: 0, credito: true },
  { conta: "6500", nome: "Utilities", fornecedor: "Electric Ireland", base: 380, taxa: 13.5, credito: true },
  { conta: "6600", nome: "Insurance", fornecedor: "Allianz Business", base: 265, taxa: 0, credito: true },
  { conta: "6700", nome: "Software and subscriptions", fornecedor: "Sage Ireland", base: 129, taxa: 23, credito: true },
  { conta: "6750", nome: "Printing, postage and stationery", fornecedor: "Codex Office Supplies", base: 74, taxa: 23, credito: true },
  { conta: "6800", nome: "Motor and travel", fornecedor: "Circle K Fuel Card", base: 620, taxa: 23, credito: true },
  { conta: "6850", nome: "Repairs and maintenance", fornecedor: "Kelleher Maintenance", base: 210, taxa: 13.5, credito: true },
  { conta: "6900", nome: "Professional fees", fornecedor: "O'Brien & Co Accountants", base: 340, taxa: 23, credito: true },
  { conta: "6910", nome: "Advertising", fornecedor: "Meta Platforms Ireland", base: 185, taxa: 23, credito: true },
  { conta: "6990", nome: "Staff entertainment", fornecedor: "The Anchor Restaurant", base: 96, taxa: 13.5, credito: false },
];

const FORNECEDORES_CUSTO = [
  "Musgrave Wholesale", "Pallas Foods", "Antalis Paper", "Brennan Supplies",
  "Kearns Transport", "Fastway Couriers",
];
const CLIENTES_VENDA = [
  "Cork City Council", "Dunnes Stores", "Fitzgerald Hotels", "Ballymaloe House",
  "Blarney Woollen Mills", "Trinity Campus Services",
];
const ORIGENS = ["upload", "email", "phone"];

module.exports = { ANOS, PERFIS, DESPESAS, FORNECEDORES_CUSTO, CLIENTES_VENDA, ORIGENS };
