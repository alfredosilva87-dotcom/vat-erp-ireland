-- =====================================================================
--  O formato legal irlandês, e a porta de entrada dos saldos
--
--  Duas coisas, e elas andam juntas:
--
--  1. O `report_group` passa a falar a língua do **Schedule 3A** do
--     Companies Act 2014 — o formato que uma empresa PEQUENA entrega ao
--     CRO. (Schedule 3 é para média e grande; usar aquele daria um
--     balanço com rubricas que o cliente destes escritórios não usa.)
--
--     A Irlanda não impõe plano de contas: impõe o FORMATO. Por isso a
--     rubrica é coluna e o código é livre — dois escritórios podem
--     numerar diferente e entregar o mesmo balanço.
--
--  2. De-para e carga de saldos. Sem isto o balanço nunca fecha: os
--     nossos documentos só têm o MOVIMENTO. O que veio antes — o saldo
--     do banco, o capital social, os lucros acumulados, os títulos em
--     aberto — não está em documento nenhum, e um balanço só com
--     movimento mostra património zero, que é falso.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. As rubricas do Schedule 3A
--
-- Nomes escolhidos para casarem com as linhas da demonstração, não com
-- a nossa numeração: é a rubrica que decide onde o saldo aparece no
-- relatório, e é ela que tem de sobreviver a alguém renumerar o plano.
-- ---------------------------------------------------------------------
update chart_of_accounts set report_group = case report_group
  -- ---- BALANÇO: ativo ----
  when 'fixed_assets'        then 'fixed_assets_tangible'
  when 'inventory'           then 'stocks'
  when 'trade_debtors'       then 'debtors'
  when 'vat_receivable'      then 'debtors'          -- VAT a recuperar é devedor
  when 'prepayments'         then 'debtors'          -- entra em Debtors no 3A
  when 'bank'                then 'cash'
  when 'cash'                then 'cash'
  -- ---- BALANÇO: passivo ----
  -- O 3A separa por PRAZO, não por natureza: o que vence em até um ano
  -- e o que vence depois. Fornecedores, VAT e PAYE são todos "dentro de
  -- um ano"; empréstimo costuma ser depois.
  when 'trade_creditors'     then 'creditors_within_1y'
  when 'vat_payable'         then 'creditors_within_1y'
  when 'paye'                then 'creditors_within_1y'
  when 'payroll_liabilities' then 'creditors_within_1y'
  when 'accruals'            then 'creditors_within_1y'
  when 'tax_payable'         then 'creditors_within_1y'
  when 'loans'               then 'creditors_after_1y'
  -- ---- BALANÇO: capital e reservas ----
  when 'share_capital'       then 'share_capital'
  when 'retained_earnings'   then 'profit_loss_account'
  -- ---- DRE ----
  when 'sales'               then 'turnover'
  when 'other_income'        then 'other_operating_income'
  when 'cost_of_sales'       then 'cost_of_sales'
  when 'operating_expenses'  then 'administrative_expenses'
  when 'finance'             then 'interest_and_similar'
  when 'tax'                 then 'tax_on_profit'
  else report_group
end;

-- Amortização acumulada é redutora do ativo: fica na mesma rubrica do
-- bem, com saldo credor, e é a soma que dá o valor líquido.
update chart_of_accounts set report_group = 'fixed_assets_tangible' where code = '1690';

-- ---------------------------------------------------------------------
-- 2. DE-PARA — o plano do cliente e o nosso
--
-- Cliente que chega traz o plano do sistema antigo. Alguém tem de dizer
-- que o "310 Fornecedores" dele é o nosso "2100 Trade creditors".
--
-- O mapa é POR CLIENTE porque o código antigo é dele; o nosso plano é
-- compartilhado. Serve duas vezes: na carga de saldos, e depois, se
-- vier extrato ou arquivo do sistema antigo.
--
-- `external_name` fica guardado mesmo sendo redundante: quando o mapa
-- está errado, é o NOME do lado de lá que denuncia — o código sozinho
-- não diz a ninguém que 310 devia ser cliente e não fornecedor.
-- ---------------------------------------------------------------------
create table if not exists account_mapping (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  external_code text not null,
  external_name text,
  account_code  text not null,
  created_by    uuid references app_users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (client_id, external_code)
);

create index if not exists idx_map_client on account_mapping(client_id);

-- ---------------------------------------------------------------------
-- 3. A CARGA DE SALDOS
--
-- Cada cliente entra com a própria data de corte: uma empresa fechou em
-- dezembro, outra em março. A data é do CLIENTE, não do sistema.
--
-- O saldo em si não ganha tabela: vira um lançamento normal, com
-- `source_module = 'opening'`, e por isso passa pela mesma trava de
-- partidas dobradas que todo o resto. Um balancete de abertura que não
-- fecha é recusado pelo banco, igual a qualquer lançamento — que é
-- exatamente o que se quer de uma carga.
--
-- Esta tabela guarda só o CABEÇALHO da carga: quando foi, quem fez, e
-- qual lançamento ela gerou. Serve para a tela saber se o cliente já
-- tem abertura e para poder refazer (estornando o lançamento anterior)
-- sem adivinhar qual dos lançamentos era a carga.
-- ---------------------------------------------------------------------
create table if not exists opening_balances (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  -- A data do último balanço fechado do cliente. Os saldos são a posição
  -- NESTE dia; o movimento dos nossos documentos começa no dia seguinte.
  cutoff_date  date not null,
  source_note  text,          -- "Balancete Sage, fecho 31/12/2025"
  journal_id   uuid references journal(id) on delete set null,
  created_by   uuid references app_users(id),
  created_at   timestamptz not null default now(),
  -- Uma carga viva por cliente. Refazer estorna a anterior e cria outra;
  -- duas ativas dariam património em dobro sem ninguém notar.
  unique (client_id)
);

-- ---------------------------------------------------------------------
-- 4. O balanço e o DRE, prontos para leitura
--
-- Vistas em cima do razão. Nenhum número aqui é calculado por fora:
-- se o balanço não bater, o erro está num lançamento, e o drill-down
-- leva até ele.
-- ---------------------------------------------------------------------

-- Saldo por conta, acumulado até uma data. O DRE precisa do movimento
-- do PERÍODO e o balanço do saldo ACUMULADO — por isso a vista entrega
-- as duas coisas e quem consulta decide o recorte pela data.
create or replace view account_balances as
select
  j.client_id,
  l.account_code,
  coalesce(c.description, l.account_code) as account_name,
  c.type,
  c.report_group,
  j.posting_date,
  sum(l.debit) as debit,
  sum(l.credit) as credit,
  sum(case when c.type in ('asset','expense') then l.debit - l.credit
           else l.credit - l.debit end) as balance
from journal_lines l
join journal j on j.id = l.journal_id
left join chart_of_accounts c on c.code = l.account_code and c.type is not null
group by j.client_id, l.account_code, c.description, c.type, c.report_group, j.posting_date;
