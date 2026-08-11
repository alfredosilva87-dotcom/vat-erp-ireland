-- =====================================================================
-- Camada A5 — fechamento do período.
--
-- O relatório de conciliação é o que o escritório usa para PROVAR que o mês
-- fecha. O fechamento guarda esse momento: o saldo que o extrato de papel dizia,
-- o saldo que o sistema calculou, e a diferença entre os dois.
--
-- Guardar isso não é enfeite. Sem o número que foi aceito no dia, ninguém
-- consegue, três meses depois, dizer se o mês fechou de verdade ou se alguém
-- mexeu em algo depois — e é exatamente essa pergunta que uma auditoria faz.
--
-- O cadeado (`locked`) impede refazer conciliação em mês já fechado. É a mesma
-- ideia do bloqueio de período de qualquer contabilidade: depois de declarado,
-- mudar o passado exige reabrir o período de propósito, nunca por acidente.
-- =====================================================================

create table if not exists bank_closings (
  id                uuid primary key default gen_random_uuid(),
  bank_account_id   uuid not null references bank_accounts(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,

  -- Fecha ATÉ esta data, inclusive.
  period_end        date not null,

  -- O que o sistema calculou a partir das linhas importadas.
  statement_balance numeric(14,2) not null,
  -- O que o sistema tem lançado (a soma das transações).
  system_balance    numeric(14,2) not null,
  -- O saldo final que o contador leu no extrato de papel. É o único número
  -- aqui que não vem do sistema, e por isso é o que dá valor à conferência.
  reported_balance  numeric(14,2),
  -- reported_balance - statement_balance. Zero significa que todas as linhas
  -- do banco entraram.
  difference        numeric(14,2),

  -- Fotografia do que estava em aberto no momento do fechamento, para o
  -- relatório continuar explicável depois que essas pendências forem resolvidas.
  unreconciled_lines_count int not null default 0,
  unreconciled_lines_total numeric(14,2) not null default 0,
  outstanding_txn_count    int not null default 0,
  outstanding_txn_total    numeric(14,2) not null default 0,

  note              text,
  locked            boolean not null default true,
  created_by        uuid references app_users(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- Um fechamento por conta e data: refazer o mesmo período substitui, não
-- acumula duas versões da verdade.
create unique index if not exists idx_bank_closings_period
  on bank_closings(bank_account_id, period_end);
create index if not exists idx_bank_closings_client
  on bank_closings(client_id, period_end desc);

alter table bank_closings enable row level security;
