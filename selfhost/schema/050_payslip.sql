-- O PAYSLIP gravado — e nao recalculado a cada leitura.
--
-- ---------------------------------------------------------------------------
-- POR QUE ISTO TEM DE EXISTIR
--
-- A base cumulativa do PAYE precisa do ACUMULADO ate a semana anterior. Se o
-- acumulado fosse recalculado do zero a cada abertura de tela, mudar uma taxa
-- na tabela fiscal em Setembro reescrevia em silencio o imposto de Janeiro a
-- Agosto — e a folha de Setembro vinha com um acerto gigante que ninguem sabia
-- explicar.
--
-- O payslip fechado e um FACTO: foi isto que se reteve, com esta tabela, nesta
-- data. Alterar a tabela depois muda as folhas SEGUINTES, e nao o passado.
--
-- ---------------------------------------------------------------------------
-- RASCUNHO E FECHADO, E SO O FECHADO CONTA
--
-- `draft` calcula-se e mostra-se as vezes que forem precisas, e nao mexe no
-- acumulado de ninguem. `final` entra no acumulado e deixa de se poder
-- recalcular por cima — reabrir e um acto proprio, como no razao.
--
-- Sem esta separacao, abrir a tela duas vezes somava duas vezes.

create table if not exists hr_payslip (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  employee_id uuid not null references hr_employees(id) on delete cascade,

  year int not null,
  period_no int not null,              -- semana ISO, quinzena ou mes
  freq_type text not null check (freq_type in ('weekly','fortnightly','monthly')),
  pay_date date not null,              -- escolhe a tabela e a linha de PRSI

  -- O que se pagou e o que se reteve, em CENTIMOS INTEIROS.
  gross_cents bigint not null default 0,
  paye_cents bigint not null default 0,
  usc_cents bigint not null default 0,
  prsi_ee_cents bigint not null default 0,
  prsi_er_cents bigint not null default 0,
  net_cents bigint not null default 0,

  -- O acumulado DEPOIS deste payslip. E daqui que o seguinte parte.
  cum_gross_cents bigint not null default 0,
  cum_paye_cents bigint not null default 0,
  cum_usc_cents bigint not null default 0,
  cum_prsi_cents bigint not null default 0,

  /*
   * O QUE FOI USADO, gravado junto.
   *
   * Sem isto, seis meses depois ninguem consegue responder a "porque e que esta
   * semana reteve tanto?". Com o cut-off, os creditos, a base e o ano da tabela
   * ao lado do numero, a pergunta responde-se olhando.
   */
  cutoff_used_cents bigint not null default 0,
  credits_used_cents bigint not null default 0,
  basis text not null default 'cumulativa',
  tax_year_used int,
  table_confirmed boolean not null default false,
  warnings jsonb not null default '[]'::jsonb,

  status text not null default 'draft' check (status in ('draft','final')),
  finalised_at timestamptz,
  finalised_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Uma pessoa tem UM payslip por periodo e por bloco. Sem isto, correr a folha
  -- duas vezes criava dois, e o acumulado somava a dobrar.
  unique (employee_id, year, period_no, freq_type)
);

create index if not exists idx_payslip_cliente on hr_payslip(client_id, year, period_no);
create index if not exists idx_payslip_acumulado on hr_payslip(employee_id, year, status, period_no);

/*
 * O payslip FECHADO nao se altera nem se apaga.
 *
 * Mesma disciplina do cadeado do razao (migracao 039), e pela mesma razao: um
 * numero ja entregue ao empregado e ja submetido a Revenue nao pode mudar por
 * baixo. Corrigir faz-se reabrindo — que e um acto deliberado, com registo.
 *
 * O gatilho deixa passar a propria REABERTURA (final -> draft), senao nao
 * haveria como corrigir nada.
 */
create or replace function payslip_fechado_nao_muda() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'final' then
      raise exception 'Payslip fechado (semana %/%) nao se apaga. Reabra primeiro.', old.period_no, old.year;
    end if;
    return old;
  end if;

  if old.status = 'final' and new.status = 'final' then
    raise exception 'Payslip fechado (semana %/%) nao se altera. Reabra primeiro.', old.period_no, old.year;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payslip_fechado_nao_muda on hr_payslip;
create trigger trg_payslip_fechado_nao_muda
  before update or delete on hr_payslip
  for each row execute function payslip_fechado_nao_muda();
