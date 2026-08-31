-- O CADEADO DO PERIODO ALCANCA O DOCUMENTO, O BANCO E O FINANCEIRO.
--
-- ---------------------------------------------------------------------------
-- O BURACO QUE ISTO TAPA
--
-- O 039 travou o RAZAO e mais nada. Alfredo apontou o resto: "impede lancamento
-- da nota e movimentos financeiros e fiscais no periodo retroativo, mesma
-- logica que o contas a pagar e banco".
--
-- Sem isto, uma nota de marco entrava depois de marco fechado. Com a
-- contabilidade ligada, a partida era recusada e a nota FICAVA — meia
-- integracao fabricada por nos, do tipo exacto que a tela de nao integrados
-- existe para acusar. Com a contabilidade desligada, entrava inteira e mudava
-- em silencio o IVA de um periodo ja declarado.
--
-- ---------------------------------------------------------------------------
-- A DATA QUE MANDA E A CONTABIL, E NAO A DO DOCUMENTO
--
-- Esta e a decisao que faz isto ser usavel em vez de irritante.
--
-- Uma fatura de fornecedor datada de 15/03 chega em maio. Isso e o normal do
-- mundo, nao e um erro — e recusa-la por causa da data dela empurraria alguem
-- a mudar a data para a conseguir lancar, que e o pior desfecho possivel.
--
-- Por isso a trava olha para `posting_date` na nota (a data em que se lanca,
-- que ja nasce com o dia de hoje quando ninguem a escolhe — ver `store.ts`), e
-- nao para `invoice_date`. A nota de marco entra em maio, no periodo aberto,
-- com a data do documento preservada. E uma nota que alguem tente lancar DENTRO
-- de marco e recusada, que era o pedido.
--
-- ---------------------------------------------------------------------------
-- POR QUE `ledger_items` SO E TRAVADA NOS TITULOS SEM DOCUMENTO
--
-- Porque ali `issue_date` e a data DO DOCUMENTO e nao a contabil: o titulo de
-- uma compra nasce com a data da fatura, porque e dela que correm os 30 dias
-- do fornecedor. Travar por essa data recusaria o titulo daquela mesma fatura
-- de 15/03 lancada em maio — e partiria o fluxo normal para punir um caso que
-- nao e o que se quer impedir.
--
-- O que se quer impedir e um titulo posto A MAO dentro de um mes fechado. Esse
-- nao tem documento por tras (`manual` ou `tax`), e e so esse que a trava
-- apanha. Nos que vem de documento, quem ja os guarda e a trava da propria nota
-- e a do razao.
-- ---------------------------------------------------------------------------

-- A regra, num sitio so -----------------------------------------------------

create or replace function periodo_fechado_recusar(
  cli uuid, d_antiga date, d_nova date
) returns void
language plpgsql as $$
declare travada date;
begin
  if cli is null then return; end if;

  /*
   * O cliente a ser APAGADO nao pode ficar preso pelo proprio cadeado.
   *
   * `on delete cascade` manda as notas, os movimentos e as partidas abaixo, e
   * cada uma delas passa por aqui. Sem esta saida, apagar um cliente que tenha
   * um so mes fechado era impossivel — e a mensagem de erro falaria de um
   * fechamento, que ninguem ligaria a um cliente que se esta a apagar.
   */
  if not exists (select 1 from clients where id = cli) then return; end if;

  -- As DUAS datas contam: tirar um movimento de um mes fechado muda esse mes
  -- tanto como po-lo la.
  select p.period_end into travada
    from accounting_periods p
   where p.client_id = cli
     and p.reopened_at is null
     and (
       (d_antiga is not null and d_antiga between p.period_start and p.period_end)
       or (d_nova is not null and d_nova between p.period_start and p.period_end)
     )
   limit 1;

  if travada is not null then
    raise exception
      'Periodo fechado ate %. Para lancar ou mexer nesta data, reabra o fechamento desse mes primeiro.', travada
      using errcode = 'check_violation';
  end if;
end;
$$;

-- O razao passa a usar a regra comum (e ganha a saida da cascata) -----------

create or replace function guard_periodo_fechado() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform periodo_fechado_recusar(old.client_id, old.posting_date, null);
    return old;
  elsif tg_op = 'UPDATE' then
    perform periodo_fechado_recusar(new.client_id, old.posting_date, new.posting_date);
  else
    perform periodo_fechado_recusar(new.client_id, null, new.posting_date);
  end if;
  return new;
end;
$$;

-- Um gatilho generico, para as tabelas com cliente e uma data --------------

create or replace function guard_periodo_fechado_col() returns trigger
language plpgsql as $$
declare
  col text := tg_argv[0];
  cli uuid;
  d_antiga date;
  d_nova date;
begin
  -- `to_jsonb` e o que permite um gatilho so para tabelas com nomes de coluna
  -- diferentes. A alternativa era cinco funcoes iguais a menos de uma palavra,
  -- e cinco sitios para corrigir quando a regra mudar.
  if tg_op <> 'INSERT' then
    cli := nullif(to_jsonb(old) ->> 'client_id', '')::uuid;
    d_antiga := nullif(to_jsonb(old) ->> col, '')::date;
  end if;
  if tg_op <> 'DELETE' then
    cli := nullif(to_jsonb(new) ->> 'client_id', '')::uuid;
    d_nova := nullif(to_jsonb(new) ->> col, '')::date;
  end if;

  perform periodo_fechado_recusar(cli, d_antiga, d_nova);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- E outro para o que so chega ao cliente pelo titulo -----------------------

create or replace function guard_periodo_fechado_via_titulo() returns trigger
language plpgsql as $$
declare
  col text := tg_argv[0];
  item uuid;
  cli uuid;
  d_antiga date;
  d_nova date;
begin
  if tg_op <> 'INSERT' then
    item := (to_jsonb(old) ->> 'ledger_item_id')::uuid;
    d_antiga := nullif(to_jsonb(old) ->> col, '')::date;
  end if;
  if tg_op <> 'DELETE' then
    item := (to_jsonb(new) ->> 'ledger_item_id')::uuid;
    d_nova := nullif(to_jsonb(new) ->> col, '')::date;
  end if;

  -- Titulo ja apagado (cascata): nao ha periodo a defender, e a limpeza tem de
  -- poder correr. Mesma logica da saida em `periodo_fechado_recusar`.
  select client_id into cli from ledger_items where id = item;
  perform periodo_fechado_recusar(cli, d_antiga, d_nova);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Titulos sem documento: so `manual` e `tax`. Ver o bloco no topo. ---------

create or replace function guard_periodo_fechado_titulo() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.source_module in ('manual', 'tax') then
      perform periodo_fechado_recusar(old.client_id, old.issue_date, null);
    end if;
    return old;
  end if;

  if new.source_module in ('manual', 'tax')
     or (tg_op = 'UPDATE' and old.source_module in ('manual', 'tax')) then
    perform periodo_fechado_recusar(
      new.client_id,
      case when tg_op = 'UPDATE' then old.issue_date else null end,
      new.issue_date
    );
  end if;
  return new;
end;
$$;

-- Os gatilhos ---------------------------------------------------------------

drop trigger if exists trg_periodo_fechado_invoices on invoices;
create trigger trg_periodo_fechado_invoices
  before insert or update or delete on invoices
  for each row execute function guard_periodo_fechado_col('posting_date');

drop trigger if exists trg_periodo_fechado_sales on sales;
create trigger trg_periodo_fechado_sales
  before insert or update or delete on sales
  for each row execute function guard_periodo_fechado_col('entry_date');

drop trigger if exists trg_periodo_fechado_bank on bank_transactions;
create trigger trg_periodo_fechado_bank
  before insert or update or delete on bank_transactions
  for each row execute function guard_periodo_fechado_col('txn_date');

drop trigger if exists trg_periodo_fechado_titulos on ledger_items;
create trigger trg_periodo_fechado_titulos
  before insert or update or delete on ledger_items
  for each row execute function guard_periodo_fechado_titulo();

drop trigger if exists trg_periodo_fechado_baixas on ledger_settlements;
create trigger trg_periodo_fechado_baixas
  before insert or update or delete on ledger_settlements
  for each row execute function guard_periodo_fechado_via_titulo('settled_on');

drop trigger if exists trg_periodo_fechado_encargos on ledger_charges;
create trigger trg_periodo_fechado_encargos
  before insert or update or delete on ledger_charges
  for each row execute function guard_periodo_fechado_via_titulo('incurred_on');

comment on function periodo_fechado_recusar(uuid, date, date) is
  'A regra do periodo fechado, comum a todos os gatilhos. Ver selfhost/schema/040.';
