-- Encargos do título, e a conta contábil dele.
--
-- Pedido do Alfredo (2026-08-24): nos documentos de contas a pagar e receber
-- tem de ser possível editar a conta contábil e incluir taxas, juros e
-- despesas.
--
-- O título nascia com um valor só, o do documento. Mas o que se paga quase
-- nunca é o que estava na nota: entra juro de atraso, taxa de transferência,
-- multa — e um desconto, quando se paga adiantado. Sem onde os pôr, essas
-- diferenças acabavam a ser "resolvidas" alterando o valor original do título,
-- que apaga a única coisa que se queria saber depois: quanto era e quanto
-- custou a mais.

-- A conta de controlo deste título. Nula = a conta padrão da natureza
-- (fornecedores para pagar, clientes para receber). Existe para o escritório
-- que separa fornecedores por conta.
alter table ledger_items
  add column if not exists account_code text;

create table if not exists ledger_charges (
  id uuid primary key default gen_random_uuid(),
  ledger_item_id uuid not null references ledger_items(id) on delete cascade,

  -- Rótulo do encargo. Escolhe a conta sugerida e serve ao relatório: "quanto
  -- pagámos de juro este ano" é uma pergunta que se faz.
  kind text not null check (kind in ('interest', 'fee', 'penalty', 'other', 'discount')),

  -- SEMPRE positivo. O sinal vem do `kind`: `discount` abate, o resto acresce.
  -- Guardar sinal no valor faria "-50" significar coisas diferentes conforme
  -- quem lançou, e ninguém conseguiria somar juros com confiança.
  amount numeric(14,2) not null check (amount > 0),

  account_code text,
  description text,
  incurred_on date not null default current_date,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_ledger_charges_item on ledger_charges(ledger_item_id);

-- A vista passa a contar os encargos.
--
-- `outstanding = original + encargos - baixas`. Antes era `original - baixas`,
-- e um título com juro aparecia como pago a menos do que devia — ou pago a
-- mais, o que é pior, porque some da lista de pendentes ainda devendo.
drop view if exists ledger_items_open;
create view ledger_items_open as
select
  i.id, i.client_id, i.kind, i.source_module, i.document_id, i.document_ref,
  i.counterparty, i.issue_date, i.due_date, i.original_amount, i.currency,
  i.journal_id, i.notes, i.account_code, i.created_at, i.updated_at,
  coalesce(c.encargos, 0) as charges_amount,
  coalesce(s.pago, 0) as settled_amount,
  i.original_amount + coalesce(c.encargos, 0) - coalesce(s.pago, 0) as outstanding_amount,
  case
    when i.original_amount + coalesce(c.encargos, 0) - coalesce(s.pago, 0) <= 0 then 'settled'
    when coalesce(s.pago, 0) > 0 then 'partial'
    when i.due_date is not null and i.due_date < current_date then 'overdue'
    else 'open'
  end as status
from ledger_items i
left join (
  select ledger_item_id, sum(amount) as pago
    from ledger_settlements group by ledger_item_id
) s on s.ledger_item_id = i.id
left join (
  select ledger_item_id,
         sum(case when kind = 'discount' then -amount else amount end) as encargos
    from ledger_charges group by ledger_item_id
) c on c.ledger_item_id = i.id;
