/**
 * Cinco clientes de DEMONSTRAÇÃO enxutos, para a base da nuvem.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE SCRIPT EXISTE AO LADO DO `seed-demo-clients.js`
 *
 * Aquele faz TRÊS ANOS de movimento em três empresas, para os relatórios
 * comparativos terem histórico. Serve para conferir gráfico e variação, e é
 * demasiado para conferir um razão à mão: são centenas de lançamentos.
 *
 * Este é o oposto e de propósito: CINCO documentos de cada lado, por cliente,
 * num ano só. É pouco o bastante para uma pessoa somar no papel e dizer se o
 * balanço fecha — que é exatamente o teste que se quer fazer quando o motor
 * contábil é novo.
 *
 * A outra diferença é o CICLO DE COBRANÇA. Aqui cada título nasce num estado
 * diferente a propósito:
 *
 *   - quitado de uma vez (pagamento no extrato, casado pelo documento)
 *   - quitado EM PARCELAS (duas ou três baixas até fechar)
 *   - parcialmente pago, com saldo em aberto  ← é aqui que se testa fechar
 *   - intocado, totalmente em aberto
 *
 * Um seed onde tudo está pago não exercita baixa nenhuma, e um onde nada está
 * pago não prova que a baixa fecha o título.
 * ---------------------------------------------------------------------------
 *
 * NÃO escreve no banco. Imprime SQL no stdout, e quem aplica é quem chamou.
 * É deliberado: a chave de serviço da base da nuvem não está neste repositório
 * (o `.env.local` aponta para o localhost), e um script que guarda credencial
 * de produção é a forma mais fácil de a publicar sem querer — este repositório
 * é público.
 *
 * Uso:  node scripts/seed-demo-supabase.js > /tmp/seed.sql
 *       node scripts/seed-demo-supabase.js --parte=limpeza|base|documentos
 *
 * Determinístico: a mesma execução dá exatamente os mesmos números. Um
 * relatório que muda sozinho entre duas conferências não se consegue conferir.
 */

const ANO = 2026;
const ABERTURA = "2025-12-31";

const r2 = (n) => Math.round(n * 100) / 100;
const q = (s) => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined ? "null" : String(r2(Number(v))));
const b = (v) => (v ? "true" : "false");
const dia = (m, d) => `${ANO}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/*
 * Os cinco. Setores diferentes porque a alíquota e a conta de despesa mudam
 * com o ramo — cinco empresas iguais testariam um caminho só.
 *
 * TUDO INVENTADO. Nome, VAT, CRO e endereço não correspondem a empresa
 * nenhuma; os números de VAT seguem só o FORMATO irlandês para as telas que
 * validam formato não recusarem.
 */
const CLIENTES = [
  {
    code: "DEMO-KIL", name: "Kilkenny Craft Bakery Ltd", vat: "3355771TA", cro: "556101",
    atividade: "Bakery and retail of foodstuffs", contaReceita: "4100",
    contato: "Aoife Brennan", email: "contas@kilkennycraftbakery.example",
    morada: "12 Parliament Street, Kilkenny, R95 X4T2",
    abertura: { banco: 14200, clientes: 6300, fixo: 28000, stock: 4100, fornecedores: 8900, emprestimo: 12000, capital: 100 },
  },
  {
    code: "DEMO-SHA", name: "Shannon Freight Services Ltd", vat: "4417882RH", cro: "561744",
    atividade: "Road haulage and warehousing", contaReceita: "4200",
    contato: "Declan O'Meara", email: "accounts@shannonfreight.example",
    morada: "Unit 7, Shannon Free Zone, Co. Clare, V14 KD73",
    abertura: { banco: 21500, clientes: 18400, fixo: 76000, stock: 0, fornecedores: 15200, emprestimo: 48000, capital: 100 },
  },
  {
    code: "DEMO-GAL", name: "Galway Coastal Seafood Ltd", vat: "5528993WB", cro: "573210",
    atividade: "Wholesale of fish and seafood", contaReceita: "4100",
    contato: "Niamh Fahy", email: "office@galwaycoastal.example",
    morada: "New Docks, Galway, H91 P8R4",
    abertura: { banco: 9800, clientes: 24600, fixo: 41000, stock: 11700, fornecedores: 19400, emprestimo: 20000, capital: 100 },
  },
  {
    code: "DEMO-DUB", name: "Dublin Green Landscaping Ltd", vat: "6639004CD", cro: "588456",
    atividade: "Landscaping and grounds maintenance", contaReceita: "4200",
    contato: "Sean Kavanagh", email: "admin@dublingreen.example",
    morada: "3 Blackhorse Avenue, Dublin 7, D07 Y2N9",
    abertura: { banco: 7400, clientes: 9100, fixo: 19500, stock: 1200, fornecedores: 6800, emprestimo: 0, capital: 100 },
  },
  {
    code: "DEMO-COR", name: "Cork Tech Repairs Ltd", vat: "7740115EF", cro: "594822",
    atividade: "Repair of computers and electronics", contaReceita: "4200",
    contato: "Laura Hegarty", email: "billing@corktechrepairs.example",
    morada: "18 Oliver Plunkett Street, Cork, T12 W5K8",
    abertura: { banco: 12600, clientes: 5200, fixo: 8900, stock: 3400, fornecedores: 4700, emprestimo: 0, capital: 100 },
  },
];

/**
 * As cinco compras de cada cliente.
 *
 * `credito: false` é o VAT que a Irlanda NÃO devolve — refeição e
 * representação. Nesse caso o imposto entra no custo em vez de ir para
 * "VAT a recuperar", e é o caminho que mais erra em silêncio: tratar tudo
 * como recuperável infla o ativo e o crédito do cliente.
 */
const COMPRAS = [
  { fornecedor: "Ryan Wholesale Ltd",    conta: "5100", nome: "Purchases",                        net: 1840.00, taxa: 0,    credito: true,  tipo: "invoice" },
  { fornecedor: "Munster Utilities",     conta: "6500", nome: "Utilities",                        net: 412.50,  taxa: 13.5, credito: true,  tipo: "invoice" },
  { fornecedor: "Leinster Insurance",    conta: "6600", nome: "Insurance",                        net: 980.00,  taxa: 0,    credito: true,  tipo: "invoice" },
  { fornecedor: "The Harbour Restaurant",conta: "6200", nome: "Meals and entertainment",          net: 265.00,  taxa: 13.5, credito: false, tipo: "receipt" },
  { fornecedor: "Office Depot Ireland",  conta: "6750", nome: "Printing, postage and stationery", net: 318.40,  taxa: 23,   credito: true,  tipo: "invoice" },
];

const VENDAS = [
  { cliente: "Fitzgerald Hotels Ltd",  net: 4200.00, taxa: 23 },
  { cliente: "Corrib Retail Group",    net: 3150.00, taxa: 23 },
  { cliente: "Boyne Valley Catering",  net: 2480.00, taxa: 13.5 },
  { cliente: "Liffey Property Mgmt",   net: 1875.00, taxa: 23 },
  { cliente: "Vendas de balcao",       net: 1290.00, taxa: 13.5 },
];

/**
 * O que acontece a cada título depois de nascer.
 *
 * `banco` = pagamento já no extrato, casado pelo documento: o backfill dá a
 * baixa sozinho. `parcelas` = baixas feitas pela API depois, uma a uma, na
 * fração indicada do total. Somando 1 fecha; somando menos deixa saldo.
 */
const CICLO_COMPRAS = [
  { i: 0, modo: "banco" },
  { i: 1, modo: "parcelas", fracoes: [0.5, 0.5] },
  { i: 2, modo: "parcelas", fracoes: [0.4] },
  { i: 3, modo: "parcelas", fracoes: [0.6] },
  { i: 4, modo: "aberto" },
];
const CICLO_VENDAS = [
  { i: 0, modo: "banco" },
  { i: 1, modo: "parcelas", fracoes: [0.34, 0.33, 0.33] },
  { i: 2, modo: "parcelas", fracoes: [0.25] },
  { i: 3, modo: "parcelas", fracoes: [0.5] },
  { i: 4, modo: "aberto" },
];

/**
 * A abertura, fechada POR CONSTRUÇÃO.
 *
 * Os lucros acumulados são o que sobra, e não um número escolhido. Inventar
 * os oito valores e torcer para baterem daria uma diferença que o motor
 * recusa — a trava de partidas dobradas está no banco — e o seed falharia
 * sem dizer porquê.
 */
function linhasDeAbertura(a) {
  const ativo = a.banco + a.clientes + a.fixo + a.stock;
  const passivo = a.fornecedores + a.emprestimo + a.capital;
  const acumulado = r2(ativo - passivo);
  return [
    { conta: "1100", d: a.banco, c: 0 },
    { conta: "1200", d: a.clientes, c: 0 },
    { conta: "1600", d: a.fixo, c: 0 },
    { conta: "1500", d: a.stock, c: 0 },
    { conta: "2100", d: 0, c: a.fornecedores },
    { conta: "2600", d: 0, c: a.emprestimo },
    { conta: "3100", d: 0, c: a.capital },
    { conta: "3200", d: 0, c: acumulado },
  ].filter((l) => l.d !== 0 || l.c !== 0);
}

const out = [];
const w = (s) => out.push(s);

// ------------------------------------------------------------------ limpeza

w(`-- =====================================================================`);
w(`-- LIMPEZA: apaga TUDO o que e dado de cliente nesta base.`);
w(`--`);
w(`-- Nao toca em: companies, app_users, chart_of_accounts partilhado (o plano`);
w(`-- do escritorio), vat_categories nem credit_rules — sao configuracao, e`);
w(`-- recria-los era refazer a instalacao, nao repor a demonstracao.`);
w(`-- =====================================================================`);
w(`delete from ledger_charges;`);
w(`delete from ledger_settlements;`);
w(`delete from ledger_items;`);
w(`delete from journal_lines;`);
w(`delete from journal;`);
w(`delete from opening_balances;`);
w(`delete from account_mapping;`);
w(`delete from bank_transactions;`);
w(`delete from bank_statement_lines;`);
w(`delete from bank_closings;`);
w(`delete from bank_imports;`);
w(`delete from bank_rules;`);
w(`delete from bank_accounts;`);
w(`delete from invoice_audit;`);
w(`delete from invoice_documents;`);
w(`delete from invoice_items;`);
w(`delete from invoices;`);
w(`delete from sales_items;`);
w(`delete from sales;`);
w(`delete from obligations;`);
w(`delete from recurring_obligations;`);
w(`delete from client_item_accounts;`);
w(`delete from supplier_rules;`);
w(`delete from client_integrations;`);
w(`delete from inbox_items;`);
w(`delete from mail_fetches;`);
w(`delete from mail_senders;`);
w(`delete from client_mail_routes;`);
w(`delete from hr_bank_holiday_entries;`);
w(`delete from hr_employee_hours;`);
w(`delete from hr_hour_submissions;`);
w(`delete from hr_employees;`);
w(`delete from hr_weeks;`);
w(`delete from hr_client_config;`);
w(`delete from hr_client;`);
w(`delete from branches;`);
w(`-- A conta 11030301 do cliente antigo vai junto com ele: e conta de cliente,`);
w(`-- nao do plano partilhado, e sem o cliente ficaria orfa.`);
w(`delete from chart_of_accounts where client_id is not null;`);
w(`delete from clients;`);
w(``);

// -------------------------------------------------------------------- base

w(`-- =====================================================================`);
w(`-- OS CINCO CLIENTES, a abertura e a conta bancaria de cada um.`);
w(`-- =====================================================================`);
w(`do $$`);
w(`declare`);
w(`  v_empresa uuid;`);
w(`  v_cliente uuid;`);
w(`  v_journal uuid;`);
w(`begin`);
w(`  select id into v_empresa from companies where active order by created_at limit 1;`);
w(`  if v_empresa is null then`);
w(`    raise exception 'Nao ha empresa cadastrada — os clientes ficariam invisiveis na tela.';`);
w(`  end if;`);
w(``);

for (const p of CLIENTES) {
  w(`  -- ---------------- ${p.code}  ${p.name}`);
  w(`  insert into clients (client_code, name, vat_number, tax_reg_no, cro,`);
  w(`         contact_person, email, address, activity_label, status, company_id, notes)`);
  w(`  values (${q(p.code)}, ${q(p.name)}, ${q(p.vat)}, ${q(p.vat)}, ${q(p.cro)},`);
  w(`         ${q(p.contato)}, ${q(p.email)}, ${q(p.morada)}, ${q(p.atividade)}, 'Active', v_empresa,`);
  w(`         'Cliente de DEMONSTRACAO — dados inventados, gerado por scripts/seed-demo-supabase.js')`);
  w(`  returning id into v_cliente;`);
  w(``);
  w(`  insert into journal (client_id, entry_date, posting_date, source_module, description)`);
  w(`  values (v_cliente, ${q(ABERTURA)}, ${q(ABERTURA)}, 'opening', 'Saldos de abertura')`);
  w(`  returning id into v_journal;`);
  const linhas = linhasDeAbertura(p.abertura);
  w(`  insert into journal_lines (journal_id, line_no, account_code, debit, credit, resolved_by) values`);
  w(linhas.map((l, i) =>
      `    (v_journal, ${i + 1}, ${q(l.conta)}, ${n(l.d)}, ${n(l.c)}, 'opening')`).join(",\n") + ";");
  w(`  insert into opening_balances (client_id, cutoff_date, source_note, journal_id)`);
  w(`  values (v_cliente, ${q(ABERTURA)}, 'Carga de demonstracao', v_journal);`);
  w(``);
  w(`  insert into bank_accounts (client_id, name, bank_name, account_ref, currency,`);
  w(`         opening_balance, opening_date, active, account_code)`);
  w(`  values (v_cliente, 'Conta corrente', 'Bank of Ireland', ${q(`IE29BOFI90001${p.cro}`)}, 'EUR',`);
  w(`         ${n(p.abertura.banco)}, ${q(ABERTURA)}, true, '1100');`);
  w(``);
  w(`  insert into client_integrations (client_id) values (v_cliente);`);
  w(``);
}
w(`end $$;`);
w(``);

// -------------------------------------------------------------- documentos

/*
 * Os documentos saem como UM bloco que percorre listas, e nao como 100
 * INSERTs escritos a mao.
 *
 * A forma desenrolada tinha 42 KB de SQL quase identico. Nao e so tamanho:
 * cem insercoes copiadas sao cem sitios onde um valor pode divergir sem
 * ninguem notar, e a regra que decide a data ou a aliquota fica diluida no
 * meio delas. Aqui a regra esta escrita uma vez, e os dados sao dados.
 */
w(`-- =====================================================================`);
w(`-- OS DOCUMENTOS: 5 compras e 5 vendas por cliente, no ano de ${ANO}.`);
w(`--`);
w(`-- O pagamento no extrato so existe para o PRIMEIRO de cada lado; os`);
w(`-- outros ficam por baixar, e as parcelas entram depois pela API, que e`);
w(`-- o caminho que a pessoa usa na tela.`);
w(`-- =====================================================================`);
w(`do $$`);
w(`declare`);
w(`  codigos  text[] := array[${CLIENTES.map((p) => q(p.code)).join(", ")}];`);
w(`  receitas text[] := array[${CLIENTES.map((p) => q(p.contaReceita)).join(", ")}];`);
w(`  forn     text[] := array[${COMPRAS.map((c) => q(c.fornecedor)).join(", ")}];`);
w(`  cconta   text[] := array[${COMPRAS.map((c) => q(c.conta)).join(", ")}];`);
w(`  cnome    text[] := array[${COMPRAS.map((c) => q(c.nome)).join(", ")}];`);
w(`  cnet     numeric[] := array[${COMPRAS.map((c) => n(c.net)).join(", ")}];`);
w(`  ctaxa    numeric[] := array[${COMPRAS.map((c) => n(c.taxa)).join(", ")}];`);
w(`  ccred    boolean[] := array[${COMPRAS.map((c) => b(c.credito)).join(", ")}];`);
w(`  ctipo    text[] := array[${COMPRAS.map((c) => q(c.tipo)).join(", ")}];`);
w(`  vcli     text[] := array[${VENDAS.map((v) => q(v.cliente)).join(", ")}];`);
w(`  vnet     numeric[] := array[${VENDAS.map((v) => n(v.net)).join(", ")}];`);
w(`  vtaxa    numeric[] := array[${VENDAS.map((v) => n(v.taxa)).join(", ")}];`);
w(`  ci int; i int; mes int; d date; vat numeric; bruto numeric; num text; suf text;`);
w(`  v_cliente uuid; v_conta uuid; v_doc uuid;`);
w(`begin`);
w(`  for ci in 1..array_length(codigos, 1) loop`);
w(`    select id into v_cliente from clients where client_code = codigos[ci];`);
w(`    select id into v_conta from bank_accounts where client_id = v_cliente limit 1;`);
w(`    suf := right(codigos[ci], 3);`);
w(``);
w(`    -- ---- compras`);
w(`    for i in 1..5 loop`);
w(`      /*`);
w(`       * Espalha pelos meses, mas TODOS antes de hoje.`);
w(`       *`);
w(`       * O passo era de dois meses e o quinto documento caia em setembro ou`);
w(`       * outubro. O motor recusa lancar documento com data futura — e faz`);
w(`       * bem, senao o balanco de hoje incluiria uma nota que ainda nao`);
w(`       * aconteceu — e o resultado era um seed onde 4 de 5 documentos`);
w(`       * chegavam ao razao, sem erro nenhum a dizer porque.`);
w(`       */`);
w(`      mes := 1 + (i - 1) + ((ci - 1) % 3);`);
w(`      d := make_date(${ANO}, mes, 6 + (i - 1) * 3);`);
w(`      vat := round(cnet[i] * ctaxa[i] / 100, 2);`);
w(`      bruto := cnet[i] + vat;`);
w(`      num := suf || '-C' || lpad(i::text, 2, '0');`);
w(`      insert into invoices (client_id, client_code, client_name, supplier_name,`);
w(`             invoice_number, invoice_date, posting_date, doc_type, doc_kind, currency,`);
w(`             total_net, total_vat, total_gross, total_credit, item_count, engine,`);
w(`             needs_review, extraction_confidence, source, captured_at)`);
w(`      select v_cliente, codigos[ci], c.name, forn[i], num, d, d, ctipo[i],`);
w(`             case when ctipo[i] = 'receipt' then 'receipt' else 'invoice' end, 'EUR',`);
w(`             cnet[i], vat, bruto, case when ccred[i] then vat else 0 end, 1, 'seed',`);
w(`             false, 1, case when i % 2 = 1 then 'upload' else 'email' end,`);
w(`             (d + time '09:15') at time zone 'UTC'`);
w(`        from clients c where c.id = v_cliente`);
w(`      returning id into v_doc;`);
w(`      insert into invoice_items (invoice_id, description, quantity, net_amount,`);
w(`             vat_rate_on_invoice, vat_amount_on_invoice, expected_vat_rate,`);
w(`             account_code, account_name, take_credit, credit_value)`);
w(`      values (v_doc, cnome[i], 1, cnet[i], ctaxa[i], vat, ctaxa[i],`);
w(`             cconta[i], cnome[i], ccred[i], case when ccred[i] then vat else 0 end);`);
w(`      -- So a primeira ja esta paga no extrato: o backfill da a baixa sozinho.`);
w(`      if i = 1 then`);
w(`        insert into bank_transactions (bank_account_id, client_id, txn_date, description,`);
w(`               contact_name, amount, kind, invoice_id)`);
w(`        values (v_conta, v_cliente, make_date(${ANO}, mes + 1, 4), 'Pagamento ' || num,`);
w(`               forn[i], -bruto, 'payment', v_doc);`);
w(`      end if;`);
w(`    end loop;`);
w(``);
w(`    -- ---- vendas`);
w(`    for i in 1..5 loop`);
w(`      mes := 2 + (i - 1) + (ci % 3);`);
w(`      d := make_date(${ANO}, mes, 14 + (i - 1) * 2);`);
w(`      vat := round(vnet[i] * vtaxa[i] / 100, 2);`);
w(`      bruto := vnet[i] + vat;`);
w(`      num := suf || '-V' || lpad(i::text, 2, '0');`);
w(`      insert into sales (client_id, entry_date, doc_number, customer, net_amount,`);
w(`             vat_rate, vat_amount, account_code, needs_review, source, doc_kind,`);
w(`             captured_at, extraction_confidence)`);
w(`      values (v_cliente, d, num, vcli[i], vnet[i], vtaxa[i], vat, receitas[ci], false,`);
w(`             case when vcli[i] = 'Vendas de balcao' then 'upload' else 'email' end, 'invoice',`);
w(`             (d + time '18:40') at time zone 'UTC', 1)`);
w(`      returning id into v_doc;`);
w(`      insert into sales_items (sale_id, description, quantity, unit_price, net_amount, vat_rate, vat_amount)`);
w(`      values (v_doc, case when vcli[i] = 'Vendas de balcao' then 'Resumo do periodo' else 'Fornecimento' end,`);
w(`             1, vnet[i], vnet[i], vtaxa[i], vat);`);
w(`      if i = 1 then`);
w(`        insert into bank_transactions (bank_account_id, client_id, txn_date, description,`);
w(`               contact_name, amount, kind, sale_id)`);
w(`        values (v_conta, v_cliente, make_date(${ANO}, mes + 1, 9), 'Recebimento ' || num,`);
w(`               vcli[i], bruto, 'receipt', v_doc);`);
w(`      end if;`);
w(`    end loop;`);
w(``);
w(`    -- Movimento por classificar, de proposito: sem conta e sem documento.`);
w(`    -- Nao e erro — e o que o contabilista ainda vai olhar, e o backfill`);
w(`    -- trata assim de proposito. Um seed onde tudo esta classificado nao`);
w(`    -- exercita esse caminho, que e o que aparece todos os meses na vida real.`);
w(`    insert into bank_transactions (bank_account_id, client_id, txn_date, description,`);
w(`           contact_name, amount, kind)`);
w(`    values (v_conta, v_cliente, make_date(${ANO}, 6, 18), 'Transferencia a classificar', null,`);
w(`           -(140 + (ci - 1) * 35), 'payment');`);
w(`  end loop;`);
w(`end $$;`);
w(``);

// ------------------------------------------------------- plano das parcelas

/*
 * As parcelas NÃO saem daqui em SQL.
 *
 * Uma baixa escrita à mão no banco produziria a linha de `ledger_settlements`
 * sem o movimento no banco e sem a partida no razão — três coisas que a baixa
 * de verdade faz juntas (`baixarPeloBanco` em lib/accounting/service.ts). O
 * resultado seria uma demonstração onde o título fecha e o razão não, que é
 * precisamente o defeito que se quer poder detetar.
 *
 * Por isso o plano sai como JSON no fim, para quem chamou executar pela API.
 */
const plano = CLIENTES.map((p) => ({
  code: p.code,
  compras: CICLO_COMPRAS.filter((c) => c.modo === "parcelas").map((c) => ({
    doc: `${p.code.slice(-3)}-C${String(c.i + 1).padStart(2, "0")}`, fracoes: c.fracoes,
  })),
  vendas: CICLO_VENDAS.filter((c) => c.modo === "parcelas").map((c) => ({
    doc: `${p.code.slice(-3)}-V${String(c.i + 1).padStart(2, "0")}`, fracoes: c.fracoes,
  })),
}));

if (process.argv.includes("--plano")) {
  process.stdout.write(JSON.stringify(plano, null, 2) + "\n");
} else {
  const parte = (process.argv.find((a) => a.startsWith("--parte=")) || "").split("=")[1];
  const texto = out.join("\n");
  if (!parte) process.stdout.write(texto + "\n");
  else {
    const blocos = texto.split("-- =====================================================================");
    const mapa = { limpeza: 1, base: 3, documentos: 5 };
    process.stdout.write((blocos[mapa[parte]] ?? "").trim() + "\n");
  }
}
