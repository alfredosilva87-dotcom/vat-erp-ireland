-- =====================================================================
--  O MOTOR CONTÁBIL — o razão de onde saem o balanço e o DRE
--
--  Até aqui o sistema classificava (sabia a conta de despesa de cada
--  linha de nota) mas não LANÇAVA. A apuração de VAT era somada direto
--  das notas, por fora — que funciona enquanto o VAT é a única saída e
--  quebra no dia em que o balanço tem de bater com ela.
--
--  A regra que este arquivo implementa é uma só: nenhum módulo inventa
--  contabilidade. Compra, venda e banco descrevem o que aconteceu; quem
--  transforma isso em débito e crédito é o motor, num lugar só, e o
--  balanço e o DRE são leitura do razão — nunca uma segunda conta.
--
--  O QUE FICOU DE FORA, de propósito: ordem de compra, 3-way match,
--  inventário, imobilizado, projetos, orçamento, intercompany,
--  multi-moeda. São completude de ERP de fábrica; um escritório
--  irlandês que atende empresa pequena não usa, e cada um deles é uma
--  tabela a mais para manter e explicar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O plano de contas ganha NATUREZA
--
-- Sem isto não existe balanço nem DRE: `code` e `description` não dizem
-- se 6200 é despesa ou passivo, e sem saber o lado normal da conta não
-- há como somar um demonstrativo.
--
-- `normal_side` e o demonstrativo NÃO viram coluna: saem de `type` por
-- regra fixa (ativo e despesa nascem devedoras; passivo, património e
-- receita, credoras). Guardá-los seria uma segunda verdade sobre a
-- mesma coisa, e a segunda verdade é a que fica errada.
--
-- `report_group` não é derivável e por isso é coluna: "tarifas
-- bancárias" é despesa, mas no DRE aparece em Financeiras, não em
-- Despesas operacionais. É o grupo que decide a LINHA do relatório.
-- ---------------------------------------------------------------------
alter table chart_of_accounts add column if not exists type text;
alter table chart_of_accounts add column if not exists report_group text;
-- Conta sintética (a que tem filhas) recebe rateio, não lançamento.
-- Lançar numa sintética é erro clássico e silencioso: o razão fecha e o
-- balancete fica com saldo em nível que não devia ter.
alter table chart_of_accounts add column if not exists postable boolean not null default true;

alter table chart_of_accounts drop constraint if exists chart_of_accounts_type_check;
alter table chart_of_accounts add constraint chart_of_accounts_type_check
  check (type is null or type in ('asset','liability','equity','revenue','expense'));

-- ---------------------------------------------------------------------
-- 2. O plano padrão — enxuto, e COMPARTILHADO
--
-- Um detalhe do esquema que já existia e manda no desenho: há um índice
-- único em `code` SOZINHO (`idx_coa_code`). Quer dizer que o plano de
-- contas é um só para toda a base — o mesmo 6200 vale para todos os
-- clientes, e `client_id` regista apenas quem introduziu a conta.
--
-- Não é limitação: para um escritório é o comportamento certo. Se 6200
-- significasse coisas diferentes em cada cliente, nenhum DRE seria
-- comparável entre eles, e o contador perderia a leitura de carteira que
-- é metade do valor de ter tudo num sistema só.
--
-- Cobre exatamente as linhas do balanço e do DRE que o escritório
-- entrega. Imobilizado e stock entram como CONTA (para o balanço fechar
-- quando houver saldo de abertura) mas sem módulo por trás.
--
-- As contas em português abaixo já existiam e estão em uso pelas regras
-- de classificação; ficam com o nome que têm, e só ganham natureza.
-- ---------------------------------------------------------------------
insert into chart_of_accounts (code, description, type, report_group, postable, client_id, active) values
  -- ---- ATIVO ----
  ('1100', 'Bank',                     'asset',     'bank',                 true, null, true),
  ('1110', 'Cash',                     'asset',     'cash',                 true, null, true),
  ('1200', 'Trade debtors',            'asset',     'trade_debtors',        true, null, true),
  ('1300', 'VAT receivable',           'asset',     'vat_receivable',       true, null, true),
  ('1400', 'Prepayments',              'asset',     'prepayments',          true, null, true),
  ('1500', 'Inventory',                'asset',     'inventory',            true, null, true),
  ('1600', 'Fixed assets',             'asset',     'fixed_assets',         true, null, true),
  ('1690', 'Accumulated depreciation', 'asset',     'fixed_assets',         true, null, true),
  -- ---- PASSIVO ----
  ('2100', 'Trade creditors',          'liability', 'trade_creditors',      true, null, true),
  ('2200', 'VAT payable',              'liability', 'vat_payable',          true, null, true),
  ('2300', 'PAYE / PRSI / USC',        'liability', 'paye',                 true, null, true),
  ('2400', 'Payroll liabilities',      'liability', 'payroll_liabilities',  true, null, true),
  ('2500', 'Accruals',                 'liability', 'accruals',             true, null, true),
  ('2600', 'Loans',                    'liability', 'loans',                true, null, true),
  ('2900', 'Corporation tax payable',  'liability', 'tax_payable',          true, null, true),
  -- ---- PATRIMÓNIO ----
  ('3100', 'Share capital',            'equity',    'share_capital',        true, null, true),
  ('3200', 'Retained earnings',        'equity',    'retained_earnings',    true, null, true),
  -- ---- RECEITA ----
  ('4100', 'Sales',                    'revenue',   'sales',                true, null, true),
  ('4200', 'Service revenue',          'revenue',   'sales',                true, null, true),
  ('4900', 'Other income',             'revenue',   'other_income',         true, null, true),
  -- ---- CUSTO DAS VENDAS ----
  ('5100', 'Purchases',                'expense',   'cost_of_sales',        true, null, true),
  ('5200', 'Direct costs',             'expense',   'cost_of_sales',        true, null, true),
  -- ---- DESPESAS OPERACIONAIS ----
  ('6100', 'Rent and rates',           'expense',   'operating_expenses',   true, null, true),
  ('6200', 'Meals and entertainment',  'expense',   'operating_expenses',   true, null, true),
  ('6400', 'Telecommunications',       'expense',   'operating_expenses',   true, null, true),
  ('6500', 'Utilities',                'expense',   'operating_expenses',   true, null, true),
  ('6600', 'Insurance',                'expense',   'operating_expenses',   true, null, true),
  ('6700', 'Software and subscriptions','expense',  'operating_expenses',   true, null, true),
  ('6800', 'Motor and travel',         'expense',   'operating_expenses',   true, null, true),
  ('6850', 'Repairs and maintenance',  'expense',   'operating_expenses',   true, null, true),
  ('6900', 'Professional fees',        'expense',   'operating_expenses',   true, null, true),
  ('6910', 'Advertising',              'expense',   'operating_expenses',   true, null, true),
  ('6950', 'Salaries',                 'expense',   'operating_expenses',   true, null, true),
  ('6960', 'Employer PRSI',            'expense',   'operating_expenses',   true, null, true),
  ('6990', 'Other expenses',           'expense',   'operating_expenses',   true, null, true),
  -- ---- FINANCEIRAS ----
  -- 6300 fica no bloco 6xxx porque já estava em uso; é o `report_group`
  -- que a põe em Financeiras no DRE, e não a faixa do código.
  ('6300', 'Bank charges',             'expense',   'finance',              true, null, true),
  ('7100', 'Interest payable',         'expense',   'finance',              true, null, true),
  ('7200', 'FX gain / loss',           'expense',   'finance',              true, null, true),
  -- ---- IMPOSTO SOBRE O LUCRO ----
  ('8100', 'Corporation tax',          'expense',   'tax',                  true, null, true),
  -- ---- DIFERENÇAS ----
  -- Existe para o razão nunca ficar desbalanceado por cêntimo de
  -- arredondamento. Saldo aqui é sintoma: se cresce, há regra errada.
  ('9999', 'Rounding differences',     'expense',   'operating_expenses',   true, null, true)
on conflict do nothing;

/*
 * Contas que já existiam antes desta migração ganham natureza pelo
 * código. O `insert` acima não as toca — o índice único em `code` faz o
 * `on conflict do nothing` saltá-las — então sem este `update` elas
 * ficariam sem tipo e SUMIRIAM do balancete, que é o pior resultado
 * possível: o relatório abre, fecha, e esconde lançamento.
 */
update chart_of_accounts c
   set type = v.type, report_group = v.report_group
  from (values
    ('6200', 'expense', 'operating_expenses'),
    ('6300', 'expense', 'finance'),
    ('6400', 'expense', 'operating_expenses'),
    ('9999', 'expense', 'operating_expenses')
  ) as v(code, type, report_group)
 where c.code = v.code
   and c.type is null;

-- Rede de segurança: qualquer conta que sobre sem natureza entra como
-- despesa operacional e fica VISÍVEL no balancete, em vez de calada.
-- Saldo numa dessas é sinal de que falta classificar, não de que o
-- relatório está errado.
update chart_of_accounts
   set type = 'expense', report_group = 'operating_expenses'
 where type is null;

create index if not exists idx_coa_lookup on chart_of_accounts(code, client_id);

-- ---------------------------------------------------------------------
-- 3. O RAZÃO
--
-- `journal` é o lançamento (o fato), `journal_lines` são as partidas.
--
-- Não há estado "pendente / consistido / efetivado". É deliberado: no
-- Logix esse desdobramento é a origem da falha mais cara do fluxo —
-- lotes ficam integrados, ninguém roda a consistência, e o balancete
-- não fecha; o sintoma aparece semanas depois, no fechamento. Aquilo
-- existe por causa de integração em lote entre módulos de um ERP
-- grande. Aqui o lançamento nasce balanceado ou é RECUSADO, na hora.
--
-- Nada se apaga: corrigir é estornar (`reverses`) e lançar de novo. É o
-- que mantém a trilha de auditoria e o que permite o balanço de ontem
-- continuar sendo o balanço de ontem.
-- ---------------------------------------------------------------------
create table if not exists journal (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  -- Data do documento e data contábil são coisas diferentes: a nota é de
  -- 31/12 e pode ser lançada em janeiro. O DRE usa a contábil.
  entry_date    date not null,
  posting_date  date not null,
  source_module text not null check (source_module in ('purchase','sale','bank','payroll','manual','opening')),
  -- A chave de origem: é ela que permite ir do saldo do balancete de
  -- volta ao documento. Obrigatória em tudo que não é lançamento manual.
  document_id   uuid,
  document_ref  text,
  description   text,
  reverses      uuid references journal(id),
  created_by    uuid references app_users(id),
  created_at    timestamptz not null default now(),
  constraint journal_origem_check
    check (source_module in ('manual','opening') or document_id is not null)
);

create index if not exists idx_journal_client_period on journal(client_id, posting_date);
create index if not exists idx_journal_document on journal(source_module, document_id);

create table if not exists journal_lines (
  id           uuid primary key default gen_random_uuid(),
  journal_id   uuid not null references journal(id) on delete cascade,
  line_no      integer not null,
  account_code text not null,
  debit        numeric(14,2) not null default 0,
  credit       numeric(14,2) not null default 0,
  description  text,
  /*
   * POR QUE esta conta foi escolhida.
   *
   * A resolução é uma cadeia (regra de fornecedor → conta do item →
   * padrão do tipo de documento). Sem registar o elo que respondeu, a
   * pergunta "por que esta nota foi para esta conta" não tem resposta —
   * e é a primeira pergunta que o contador faz quando o DRE surpreende.
   */
  resolved_by  text,
  -- O eixo fiscal viaja na partida: é daqui que sai o VAT3, em vez de
  -- uma segunda soma por cima das notas.
  vat_code     text,
  vat_rate     numeric(6,2),
  net_amount   numeric(14,2),
  vat_amount   numeric(14,2),
  counterparty text,
  source_line_id uuid,
  -- Uma partida é débito OU crédito. Nunca as duas, nunca nenhuma:
  -- linha zerada não é lançamento, é ruído que soma nada e ocupa razão.
  constraint journal_lines_lado_check check ((debit = 0) <> (credit = 0)),
  constraint journal_lines_positivo_check check (debit >= 0 and credit >= 0),
  unique (journal_id, line_no)
);

create index if not exists idx_jl_journal on journal_lines(journal_id);
create index if not exists idx_jl_account on journal_lines(account_code);

-- ---------------------------------------------------------------------
-- 4. A TRAVA DE PARTIDAS DOBRADAS — no banco, não no aplicativo
--
-- Um lançamento desbalanceado não pode existir. Verificar isso no código
-- protege o caminho que passa pelo código; um script de importação, uma
-- correção por SQL ou um bug numa rota nova passam por fora. Aqui não
-- passa: a transação inteira é recusada no COMMIT.
--
-- É `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` porque o
-- cabeçalho e as partidas entram em comandos separados — a conferência
-- tem de esperar o fim da transação, senão o primeiro `insert` já
-- falharia por estar sozinho.
-- ---------------------------------------------------------------------
create or replace function journal_conferir() returns trigger
language plpgsql as $$
declare
  v_journal uuid := coalesce(new.journal_id, old.journal_id);
  v_client  uuid;
  v_debito  numeric(14,2);
  v_credito numeric(14,2);
  v_linhas  integer;
  v_conta   text;
begin
  select client_id into v_client from journal where id = v_journal;
  -- Lançamento apagado por inteiro (estorno de importação): nada a conferir.
  if v_client is null then return null; end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)
    into v_debito, v_credito, v_linhas
    from journal_lines where journal_id = v_journal;

  if v_linhas < 2 then
    raise exception 'Lancamento % tem % partida(s): partida dobrada exige ao menos duas.',
      v_journal, v_linhas;
  end if;

  if v_debito <> v_credito then
    raise exception 'Lancamento % nao fecha: debito % e credito % (diferenca %).',
      v_journal, v_debito, v_credito, v_debito - v_credito;
  end if;

  /*
   * Toda conta tem de existir no plano, ter natureza e ser analítica.
   *
   * A busca é por CÓDIGO e não por (código, cliente): `idx_coa_code` é
   * único no código sozinho, então o plano é um só para a base inteira.
   *
   * Sem esta parte entra o erro clássico do Logix — o documento
   * contabiliza numa conta fora do plano, e o balancete fica com um
   * saldo que nenhum relatório sabe onde somar.
   */
  select l.account_code into v_conta
    from journal_lines l
   where l.journal_id = v_journal
     and not exists (
       select 1 from chart_of_accounts c
        where c.code = l.account_code
          and c.active
          and c.postable
          and c.type is not null
     )
   limit 1;

  if v_conta is not null then
    raise exception 'Conta % nao existe no plano deste cliente, esta inativa, e sintetica ou nao tem natureza.',
      v_conta;
  end if;

  return null;
end $$;

drop trigger if exists journal_lines_conferir on journal_lines;
create constraint trigger journal_lines_conferir
  after insert or update or delete on journal_lines
  deferrable initially deferred
  for each row execute function journal_conferir();

-- ---------------------------------------------------------------------
-- 5. TÍTULOS — contas a pagar e a receber
--
-- Uma tabela para os dois lados. São o mesmo objeto com o sinal trocado
-- (valor original, vencimento, quanto falta), e separá-las duplicaria
-- toda a lógica de baixa e de aging para não ganhar nada.
--
-- `settled_amount` NÃO existe como coluna: o saldo é a soma das baixas,
-- e uma coluna-resumo é uma segunda verdade que diverge no dia em que
-- alguém apagar uma baixa por SQL. Ver a vista `ledger_items_open`.
-- ---------------------------------------------------------------------
create table if not exists ledger_items (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  kind            text not null check (kind in ('payable','receivable')),
  source_module   text not null check (source_module in ('purchase','sale','manual')),
  document_id     uuid,
  document_ref    text,
  counterparty    text,
  issue_date      date,
  due_date        date,
  original_amount numeric(14,2) not null check (original_amount > 0),
  currency        text not null default 'EUR',
  -- O lançamento que criou o título (a provisão). Guardado para o
  -- drill-down do aging voltar ao razão e daí ao documento.
  journal_id      uuid references journal(id),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_li_client on ledger_items(client_id, kind, due_date);
create index if not exists idx_li_document on ledger_items(source_module, document_id);

-- Uma baixa. Parcial é o caso normal: €10.000 fechados por €3.000,
-- €4.000 e €3.000 são três linhas aqui, e o título fecha na terceira.
create table if not exists ledger_settlements (
  id                  uuid primary key default gen_random_uuid(),
  ledger_item_id      uuid not null references ledger_items(id) on delete cascade,
  -- Quem deu a baixa. Vindo do banco, é a transação conciliada.
  bank_transaction_id uuid references bank_transactions(id) on delete set null,
  settled_on          date not null,
  amount              numeric(14,2) not null check (amount <> 0),
  journal_id          uuid references journal(id),
  created_by          uuid references app_users(id),
  created_at          timestamptz not null default now()
);

create index if not exists idx_ls_item on ledger_settlements(ledger_item_id);
create index if not exists idx_ls_bank on ledger_settlements(bank_transaction_id);

-- Baixar mais do que o título deve é erro de digitação, não decisão.
create or replace function ledger_conferir_baixa() returns trigger
language plpgsql as $$
declare
  v_original numeric(14,2);
  v_baixado  numeric(14,2);
begin
  select original_amount into v_original from ledger_items where id = new.ledger_item_id;
  select coalesce(sum(amount), 0) into v_baixado
    from ledger_settlements where ledger_item_id = new.ledger_item_id;
  if v_baixado > v_original then
    raise exception 'Baixa de % excede o titulo (original %, ja baixado %).',
      new.amount, v_original, v_baixado - new.amount;
  end if;
  return null;
end $$;

drop trigger if exists ledger_settlements_conferir on ledger_settlements;
create constraint trigger ledger_settlements_conferir
  after insert or update on ledger_settlements
  deferrable initially deferred
  for each row execute function ledger_conferir_baixa();

-- O saldo em aberto e o estado, calculados — nunca guardados.
create or replace view ledger_items_open as
select
  i.*,
  coalesce(s.pago, 0) as settled_amount,
  i.original_amount - coalesce(s.pago, 0) as outstanding_amount,
  case
    when i.original_amount - coalesce(s.pago, 0) <= 0 then 'settled'
    when coalesce(s.pago, 0) > 0 then 'partial'
    when i.due_date is not null and i.due_date < current_date then 'overdue'
    else 'open'
  end as status
from ledger_items i
left join (
  select ledger_item_id, sum(amount) as pago
    from ledger_settlements group by ledger_item_id
) s on s.ledger_item_id = i.id;

-- ---------------------------------------------------------------------
-- 6. O BALANCETE — a única fonte do balanço e do DRE
--
-- Vista e não tabela: saldo guardado é saldo que desatualiza. Numa base
-- de escritório pequeno somar o razão é barato, e a soma nunca mente.
-- ---------------------------------------------------------------------
create or replace view trial_balance as
select
  j.client_id,
  j.posting_date,
  l.account_code,
  coalesce(c.description, l.account_code) as account_name,
  c.type,
  c.report_group,
  l.debit,
  l.credit,
  -- Saldo com o sinal da natureza: devedora positiva no débito,
  -- credora positiva no crédito. É o que faz receita e passivo
  -- aparecerem positivos no relatório sem cada tela inverter à mão.
  case when c.type in ('asset','expense') then l.debit - l.credit
       else l.credit - l.debit end as balance,
  j.source_module,
  j.document_id,
  j.id as journal_id
from journal_lines l
join journal j on j.id = l.journal_id
-- Junta só por código: o plano é compartilhado (ver `idx_coa_code`).
left join chart_of_accounts c
  on c.code = l.account_code
 and c.type is not null;
