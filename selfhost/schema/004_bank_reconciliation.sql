-- =====================================================================
-- Camada A0 — modelar dinheiro.
--
-- Até aqui o sistema conhecia documentos (notas, vendas) mas não conhecia
-- dinheiro: não havia conta bancária, não havia movimento, e a nota não tinha
-- status de paga.
--
-- O desenho segue o modelo de DUAS SÉRIES, que é o que permite provar que o
-- mês fecha:
--
--   bank_statement_lines  → o lado do BANCO. O que o extrato diz. Imutável.
--   bank_transactions     → o lado do SISTEMA. O que foi lançado aqui.
--
-- Conciliar NÃO altera nenhum dos dois lados: apenas cria o vínculo entre uma
-- linha e uma ou mais transações. Daí saem dois saldos, e a diferença entre
-- eles é exatamente o que ainda não foi conciliado.
--
-- O atalho tentador — marcar a nota como "paga" e pronto — destrói essa
-- capacidade, porque não sobra nada contra o que conferir o saldo do banco.
--
-- Ver docs/plano-conciliacao-ingestao.md (camada A0) e docs/pesquisa-xero.md.
-- =====================================================================

-- ---------- Contas bancárias do cliente ----------
create table if not exists bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  name            text not null,               -- "Conta corrente AIB"
  bank_name       text,
  account_ref     text,                        -- IBAN ou últimos dígitos
  currency        text not null default 'EUR',
  -- Ponto de partida do saldo. Sem isto os dois saldos não têm origem comum.
  opening_balance numeric(14,2) not null default 0,
  opening_date    date,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists idx_bank_accounts_client on bank_accounts(client_id, active);

-- ---------- Lote de importação ----------
-- Guardado para poder dizer "estas 120 linhas vieram deste arquivo, neste dia"
-- e, se preciso, desfazer uma importação inteira.
create table if not exists bank_imports (
  id              uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references bank_accounts(id) on delete cascade,
  filename        text,
  format          text,                        -- csv | xlsx | pdf | manual
  line_count      int  not null default 0,
  skipped_count   int  not null default 0,     -- duplicatas recusadas
  imported_by     uuid references app_users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_bank_imports_account on bank_imports(bank_account_id, created_at desc);

-- ---------- O lado do banco ----------
do $$ begin
  create type statement_line_status as enum ('unreconciled','reconciled','ignored');
exception when duplicate_object then null;
end $$;

create table if not exists bank_statement_lines (
  id              uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references bank_accounts(id) on delete cascade,
  import_id       uuid references bank_imports(id) on delete set null,
  line_date       date not null,
  description     text,
  payee           text,
  reference       text,
  -- Um único valor com sinal: positivo entra, negativo sai. Extratos que
  -- trazem débito e crédito em colunas separadas são convertidos na
  -- importação, para que todo o resto do sistema só lide com uma forma.
  amount          numeric(14,2) not null,
  balance         numeric(14,2),               -- saldo após a linha, quando o banco informa
  -- 'import' hoje; quando existir conexão automática ao banco, é só mais um
  -- valor aqui. Ver docs/plano-conciliacao-ingestao.md, seção Open Banking.
  source          text not null default 'import',
  -- Chave natural da linha. Reimportar um período sobreposto é o erro mais
  -- comum em conciliação: o contador baixa "janeiro", depois "janeiro e
  -- fevereiro", e metade entra de novo inflando tudo em silêncio.
  dedupe_key      text not null,
  status          statement_line_status not null default 'unreconciled',
  reconciled_at   timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists idx_stmt_lines_dedupe
  on bank_statement_lines(bank_account_id, dedupe_key);
create index if not exists idx_stmt_lines_account_date
  on bank_statement_lines(bank_account_id, line_date);
create index if not exists idx_stmt_lines_pending
  on bank_statement_lines(bank_account_id, status) where status = 'unreconciled';

-- ---------- O lado do sistema ----------
do $$ begin
  create type bank_txn_kind as enum ('payment','receipt','spend','receive','transfer','adjustment');
exception when duplicate_object then null;
end $$;

-- Por que o sistema decidiu o que decidiu. Xero rotula cada conciliação para
-- que o contador saiba se aquilo veio de um casamento real, de uma regra, da
-- memória de conciliações passadas, de uma predição, ou da mão dele.
do $$ begin
  create type match_reason as enum ('match','rule','memory','prediction','manual');
exception when duplicate_object then null;
end $$;

create table if not exists bank_transactions (
  id                uuid primary key default gen_random_uuid(),
  bank_account_id   uuid not null references bank_accounts(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,
  txn_date          date not null,
  description       text,
  contact_name      text,
  amount            numeric(14,2) not null,    -- mesmo sinal do extrato
  kind              bank_txn_kind not null default 'spend',

  -- Destino contábil, para o que não tem documento.
  account_code      text,
  vat_rate          numeric(4,1),

  -- Quando o movimento liquida um documento. Um pagamento parcial gera uma
  -- transação com valor menor que o total da nota; o saldo continua em aberto.
  invoice_id        uuid references invoices(id) on delete cascade,
  sale_id           uuid references sales(id)    on delete cascade,

  -- O VÍNCULO de conciliação. Nulo = lançado mas ainda não casado com o
  -- extrato (aparece como "pagamento em aberto" no relatório de fechamento).
  -- Várias transações podem apontar para a mesma linha: um pagamento único
  -- cobrindo três notas.
  statement_line_id uuid references bank_statement_lines(id) on delete set null,
  reconciled_at     timestamptz,
  reason            match_reason,

  created_by        uuid references app_users(id) on delete set null,
  created_at        timestamptz not null default now(),

  -- Um movimento liquida uma nota OU uma venda, nunca as duas.
  constraint bank_txn_one_document check (invoice_id is null or sale_id is null)
);
create index if not exists idx_bank_txn_account on bank_transactions(bank_account_id, txn_date);
create index if not exists idx_bank_txn_client on bank_transactions(client_id);
create index if not exists idx_bank_txn_line on bank_transactions(statement_line_id);
create index if not exists idx_bank_txn_invoice on bank_transactions(invoice_id) where invoice_id is not null;
create index if not exists idx_bank_txn_sale on bank_transactions(sale_id) where sale_id is not null;
create index if not exists idx_bank_txn_open
  on bank_transactions(bank_account_id) where statement_line_id is null;

-- ---------- Regras de banco (usadas a partir da camada A3) ----------
-- Criadas aqui para o modelo nascer completo; a interface vem depois.
create table if not exists bank_rules (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  -- Nulo = vale para todas as contas do cliente.
  bank_account_id uuid references bank_accounts(id) on delete cascade,
  name            text not null,
  -- A ordem importa e é o comportamento mais sutil: avalia na ordem e PARA na
  -- primeira que casa. Uma regra genérica no topo engole as específicas.
  priority        int not null default 100,
  match_all       boolean not null default true,   -- true = todas as condições
  conditions      jsonb not null default '[]',     -- [{field,op,value}]
  -- Alocação: uma ou mais contas, por valor fixo ou percentual.
  allocations     jsonb not null default '[]',     -- [{account_code,vat_rate,percent|amount}]
  contact_name    text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists idx_bank_rules_client on bank_rules(client_id, active, priority);

alter table bank_accounts       enable row level security;
alter table bank_imports        enable row level security;
alter table bank_statement_lines enable row level security;
alter table bank_transactions   enable row level security;
alter table bank_rules          enable row level security;

-- ---------- Os dois saldos ----------
-- É esta view que torna a conciliação verificável. Enquanto houver linha ou
-- transação não conciliada, os dois saldos divergem — e a diferença é
-- exatamente o que falta fechar.
create or replace view bank_account_balances as
select
  a.id                                   as bank_account_id,
  a.client_id,
  a.name,
  a.currency,
  a.opening_balance,
  -- Saldo do extrato: o que o banco diz que aconteceu.
  a.opening_balance + coalesce(s.total, 0)          as statement_balance,
  -- Saldo no sistema: o que foi lançado aqui. É este que vai para o balanço.
  a.opening_balance + coalesce(t.total, 0)          as system_balance,
  coalesce(s.unreconciled_total, 0)                 as unreconciled_statement_total,
  coalesce(s.unreconciled_count, 0)                 as unreconciled_statement_count,
  coalesce(t.unreconciled_total, 0)                 as outstanding_transaction_total,
  coalesce(t.unreconciled_count, 0)                 as outstanding_transaction_count
from bank_accounts a
left join (
  select bank_account_id,
         sum(amount)                                              as total,
         sum(amount) filter (where status = 'unreconciled')        as unreconciled_total,
         count(*)    filter (where status = 'unreconciled')        as unreconciled_count
  from bank_statement_lines
  group by bank_account_id
) s on s.bank_account_id = a.id
left join (
  select bank_account_id,
         sum(amount)                                              as total,
         sum(amount) filter (where statement_line_id is null)      as unreconciled_total,
         count(*)    filter (where statement_line_id is null)      as unreconciled_count
  from bank_transactions
  group by bank_account_id
) t on t.bank_account_id = a.id;

-- ---------- Situação de pagamento das notas ----------
-- Derivada, não guardada: um campo `paid` mantido à mão diverge do que os
-- movimentos dizem no primeiro estorno ou exclusão, e aí o número deixa de
-- ser confiável justamente quando mais importa.
create or replace view invoice_payment_status as
select
  i.id                                             as invoice_id,
  i.client_id,
  i.total_gross,
  coalesce(p.paid, 0)                              as amount_paid,
  coalesce(i.total_gross, 0) - coalesce(p.paid, 0) as amount_due,
  case
    when coalesce(i.total_gross, 0) = 0                       then 'n/a'
    when coalesce(p.paid, 0) = 0                              then 'open'
    -- Tolerância de um cêntimo: diferença de arredondamento não pode deixar
    -- uma nota eternamente "quase paga".
    when abs(coalesce(i.total_gross,0) - coalesce(p.paid,0)) <= 0.01 then 'paid'
    else 'partial'
  end                                              as payment_status
from invoices i
left join (
  select invoice_id, sum(abs(amount)) as paid
  from bank_transactions
  where invoice_id is not null
  group by invoice_id
) p on p.invoice_id = i.id;
