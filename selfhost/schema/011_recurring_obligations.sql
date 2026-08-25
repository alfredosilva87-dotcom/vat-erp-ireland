-- Obrigações recorrentes manuais (módulo Fiscal) — separado de `obligations`
-- de propósito: `obligations` é o VAT3/RTD calculado a partir de vendas e
-- compras (colunas vat_on_sales/vat_on_purchases/net, enum fechado). Aqui é o
-- oposto — nome, categoria e periodicidade livres, para o contador cadastrar
-- o que for (CRO Annual Return, CT1, P30...) sem precisar de migração nova a
-- cada tipo de obrigação.
create table if not exists recurring_obligations (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  name         text not null,
  category     text,
  periodicity  text,
  due_date     date,
  status       text not null default 'open',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_recurring_obligations_client on recurring_obligations(client_id);
alter table recurring_obligations enable row level security;
