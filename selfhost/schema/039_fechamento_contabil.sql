-- O FECHAMENTO CONTABIL DO PERIODO, e o cadeado que ele poe no razao.
--
-- ---------------------------------------------------------------------------
-- O QUE FALTAVA
--
-- Pedido do Alfredo: "precisa ter controle apos fechamento do periodo, precisa
-- ter rotinas de fechamento, apos mes fechado gera".
--
-- Ate aqui o sistema tinha fechamento de CONTA BANCARIA (`bank_closings`, com
-- cadeado proprio) e nao tinha fechamento do PERIODO CONTABIL. Sao coisas
-- diferentes: um diz "o extrato desta conta bate ate 31/03"; o outro diz "os
-- livros de marco estao fechados e ninguem mexe mais".
--
-- Sem o segundo, nada impedia que uma nota de marco entrasse em maio, depois
-- da declaracao entregue. O DRE de marco mudava sozinho, e o numero que foi
-- para a Revenue deixava de ser o numero que o sistema mostra — sem erro, sem
-- aviso, e sem forma de descobrir a nao ser reimprimindo tudo.
--
-- ---------------------------------------------------------------------------
-- POR QUE O CADEADO E UM GATILHO, E NAO UMA VERIFICACAO NA APLICACAO
--
-- Porque a aplicacao escreve no razao por muitos caminhos — nota, venda,
-- banco, folha, encargo, baixa, estorno, carga retroativa — e cada um deles e
-- uma oportunidade de esquecer a verificacao. Um esquecimento assim nao da
-- erro: grava, e so aparece meses depois num numero que mudou.
--
-- No gatilho e uma trava so, no unico sitio por onde todos passam. E a mesma
-- decisao da partida dobrada, que tambem e verificada no banco e nao no codigo.
-- ---------------------------------------------------------------------------

create table if not exists accounting_periods (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,

  -- Um periodo por linha. Guarda-se o intervalo e nao "fechado ate", porque
  -- reabrir MARCO sem reabrir abril tem de ser possivel: o erro que se corrige
  -- e quase sempre de um mes so, e obrigar a reabrir tudo o que veio depois
  -- convida a deixar tudo aberto.
  period_start date not null,
  period_end date not null,

  closed_at timestamptz not null default now(),
  closed_by uuid,

  -- Reabrir NAO apaga a linha.
  --
  -- Um fechamento que desaparece ao ser reaberto leva com ele a pergunta que
  -- alguem vai fazer depois: "este mes chegou a estar fechado, e quem o
  -- reabriu?". Num sistema contabil essa pergunta tem de ter resposta, e a
  -- resposta e a propria linha — por isso o cadeado olha para `reopened_at` e
  -- nao para a existencia do registo.
  reopened_at timestamptz,
  reopened_by uuid,
  reopen_reason text,

  -- O que se sabia na hora de fechar: a fotografia das verificacoes. Sem ela,
  -- "porque e que este mes foi fechado com uma diferenca de 12,40?" nao tem
  -- resposta seis meses depois.
  checks jsonb,
  note text,

  constraint accounting_periods_intervalo check (period_end >= period_start)
);

-- Um fecho ATIVO por periodo. Os reabertos ficam de fora do indice, senao
-- fechar marco outra vez depois de o reabrir seria recusado por duplicado.
create unique index if not exists idx_accounting_periods_unico
  on accounting_periods(client_id, period_start, period_end)
  where reopened_at is null;
create index if not exists idx_accounting_periods_cliente
  on accounting_periods(client_id, period_end desc);

alter table accounting_periods enable row level security;

-- O cadeado -----------------------------------------------------------------

create or replace function guard_periodo_fechado() returns trigger
language plpgsql as $$
declare
  cli uuid;
  d_antiga date;
  d_nova date;
  travada date;
begin
  if tg_op = 'DELETE' then
    cli := old.client_id; d_antiga := old.posting_date; d_nova := null;
  elsif tg_op = 'UPDATE' then
    cli := new.client_id; d_antiga := old.posting_date; d_nova := new.posting_date;
  else
    cli := new.client_id; d_antiga := null; d_nova := new.posting_date;
  end if;

  -- As DUAS datas contam no update: tirar um lancamento de um mes fechado
  -- muda esse mes tanto como po-lo la.
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
      'Periodo fechado ate %. Reabra o fechamento desse mes antes de mexer no razao.', travada
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_periodo_fechado on journal;
create trigger trg_guard_periodo_fechado
  before insert or update or delete on journal
  for each row execute function guard_periodo_fechado();

comment on table accounting_periods is
  'Periodos contabeis fechados. O gatilho em journal recusa qualquer partida dentro deles. Ver selfhost/schema/039.';
