-- =====================================================================
--  Módulo RH — o Payroll Control trazido para dentro do ERP
--
--  Origem: o sistema que o Matheus construiu para o escritório
--  (Node + Express + Postgres). O banco é o mesmo Postgres, então as
--  tabelas dele atravessam quase inteiras — com três diferenças, todas
--  deliberadas:
--
--    1. O cadastro de clientes DELE deixa de existir. Aqui só há um, o
--       `clients` do ERP, e é dele que tudo pende. Cliente novo entra
--       uma vez, no lugar de sempre.
--    2. `client_id` passa de INTEGER para UUID, que é a chave daqui.
--    3. Prefixo `hr_` em tudo. O módulo é separado de propósito: dá para
--       ler o que é dele numa listagem de tabelas, e nada colide com o
--       resto do ERP.
--
--  O que NÃO veio, e por quê: a tabela `users` dele (o ERP já tem
--  `app_users`, com a árvore de permissões — ver lib/permissions.ts) e a
--  tabela `settings` (a taxa de 8% é constante no cálculo dele também;
--  a linha no banco nunca era lida).
--
--  Sem `company_id` nas tabelas abaixo, e isso é intencional: elas chegam
--  à empresa pelo cliente, que é o mesmo caminho que `invoices` já usa em
--  lib/access.ts. Uma segunda cópia da empresa seria uma segunda verdade.
-- =====================================================================

-- ---------------------------------------------------------------------
-- O cadastro de clientes ganha os campos que o registo dele tinha.
--
-- São identidade de qualquer cliente irlandês, não configuração de folha:
-- por isso sobem para o cadastro raiz em vez de ficar no módulo. O que é
-- configuração de folha mora em hr_client, mais abaixo.
-- ---------------------------------------------------------------------
alter table clients add column if not exists status          text not null default 'Active';
alter table clients add column if not exists cro             text;
alter table clients add column if not exists revenue_number  text;
alter table clients add column if not exists employer_number text;
alter table clients add column if not exists contact_person  text;

create index if not exists idx_clients_status on clients(status);

-- ---------------------------------------------------------------------
-- hr_client — a configuração de folha que vale para o cliente inteiro
--
-- Era um punhado de colunas no `clients` dele. Fica à parte porque só o
-- RH usa: pôr "dia de emissão do payslip" no cadastro raiz obrigaria
-- todo cliente do ERP a ter uma coluna que 9 em 10 nunca preenchem.
--
-- Um cliente sem linha aqui simplesmente não faz folha, e é assim que
-- ele não aparece no controlo semanal.
-- ---------------------------------------------------------------------
create table if not exists hr_client (
  client_id         uuid primary key references clients(id) on delete cascade,
  -- Que tipos de payslip este cliente roda. Independentes: uma casa pode
  -- ter o pessoal ao semanal e os diretores ao mensal ao mesmo tempo.
  freq_weekly       boolean not null default false,
  freq_fortnightly  boolean not null default false,
  freq_monthly      boolean not null default false,
  -- Como os payslips são enviados. Vale para o cliente inteiro,
  -- independentemente da frequência.
  er_white_envelope boolean not null default false,
  er_whatsapp       boolean not null default false,
  er_email          boolean not null default false,
  er_not_required   boolean not null default false,
  ee_channel        text    not null default 'Email via CollSoft',
  pay_period        text,   -- Same week | 1 week after | 2 weeks after
  pay_day           text,   -- Monday … Sunday
  week_base         text,   -- Mon - Fri | Sun - Sat …
  hours_source      text,   -- Client sends information | Same every payroll
  reporting_channel text,
  auto_submit       boolean not null default false,
  -- Na Irlanda o bank holiday é direito legal, por isso entra ligado; a
  -- caixa existe para as poucas situações em que o acordo diz outra coisa.
  pays_bank_holiday boolean not null default true,
  notes             text,
  updated_by        uuid references app_users(id),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- hr_client_config — uma linha por cliente E tipo de payslip
--
-- Um cliente que roda semanal e mensal tem duas linhas, para cada uma ter
-- o seu dia de emissão, a sua origem de dados e o seu atraso de calendário.
-- ---------------------------------------------------------------------
create table if not exists hr_client_config (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  freq_type    text not null check (freq_type in ('weekly','fortnightly','monthly')),
  issue_day    text,      -- Monday … Sunday
  pay_period   text,      -- Same week | 1 week after | 2 weeks after
  -- Quantas semanas este cliente anda atrás do calendário.
  -- 0 = a semana 1 dele é a semana 1 do calendário
  -- 1 = a semana 2 do calendário é a semana 1 dele
  week_offset  integer not null default 0,
  week_base    text,
  data_source  text,      -- Client sends information | Same every payroll
  submission   text not null default 'Automatic',
                          -- Automatic | Wait for company approval
  /*
   * A partir de quando este tipo passou a ser controlado.
   *
   * Um funcionário que entrou em fevereiro mas só foi cadastrado em agosto
   * não pode fazer a empresa aparecer devendo desde fevereiro: aqueles
   * payslips ou saíram por fora, ou não existiram. A data de entrada dele
   * serve para as férias e para o histórico; o controlo semanal começa na
   * semana em que o tipo entrou no sistema.
   */
  tracked_year integer,
  tracked_week integer,
  updated_by   uuid references app_users(id),
  updated_at   timestamptz not null default now(),
  unique (client_id, freq_type)
);

create index if not exists idx_hr_cfg_client on hr_client_config(client_id);

-- ---------------------------------------------------------------------
-- hr_weeks — o controlo semanal (era a grade Semana 1..52 do Excel)
--
-- Quatro valores possíveis por item:
--   'na'      '–'    por preencher — o padrão de uma semana ainda não tocada
--   'pending' '✕'    devido, e conta como atraso depois de a semana passar
--   'done'    '✓'    enviado
--   'skip'    'n/a'  não se aplica a este cliente nesta semana
--
-- 'na' e 'skip' NÃO são a mesma coisa: o primeiro é resposta que falta e
-- mantém o cliente em "a enviar"; o segundo é uma resposta, e fecha a
-- semana. Perder essa distinção é perder a fila de trabalho.
--
-- O TIPO entra na chave porque uma empresa que roda semanal e mensal
-- envia dois payslips na mesma semana, cada um com o seu ER, EE e ROS.
-- Com um único conjunto de estados por semana, fechar o semanal dava a
-- mensal por fechada também, e ninguém dava conta.
-- ---------------------------------------------------------------------
create table if not exists hr_weeks (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  year        integer not null,
  week_no     integer not null check (week_no between 1 and 53),
  freq_type   text not null default 'weekly',
  payslip     text not null default 'na',
  er          text not null default 'na',
  ee          text not null default 'na',
  ros         text not null default 'na',
  note        text,
  updated_by  uuid references app_users(id),
  updated_at  timestamptz not null default now(),
  unique (client_id, year, week_no, freq_type)
);

create index if not exists idx_hr_weeks_lookup on hr_weeks(year, week_no);

-- ---------------------------------------------------------------------
-- hr_employees — o quadro de cada empresa
-- ---------------------------------------------------------------------
create table if not exists hr_employees (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  code            text,
  first_name      text not null,
  surname         text,
  date_of_birth   date,
  start_date      date,
  end_date        date,
  /*
   * Hourly | Weekly Fixed | Fortnightly Fixed | Monthly Fixed
   *
   * Nos fixos, `fixed_amount` é o valor do PERÍODO INTEIRO; o bruto
   * reparte-o pelas semanas do período (quinzena = 2, mês = 4,333).
   */
  pay_type        text not null default 'Hourly',
  hourly_rate     numeric(10,2) default 0,
  sunday_rate     numeric(10,2) default 0,
  fixed_amount    numeric(10,2) default 0,
  -- em que bloco de payslip este funcionário entra
  freq_type       text not null default 'weekly'
                    check (freq_type in ('weekly','fortnightly','monthly')),
  -- 'Full time' | 'Casual'. Decide a porta de entrada do bank holiday: o
  -- full time tem o direito de partida, o casual tem de ter 40 horas nas
  -- 5 semanas anteriores ao feriado.
  contract_type   text not null default 'Full time',
  -- 'Paid' | 'Banked'. Como esta pessoa quer receber o feriado: no
  -- payslip, ou somado a um saldo para gozar depois. É por PESSOA e não
  -- por empresa: na mesma casa há quem prefira o dinheiro e quem
  -- prefira o dia.
  bank_holiday_mode text not null default 'Paid',
  data_source     text not null default 'Client sends information',
  -- Saldo inicial de férias, na unidade do próprio funcionário: horas
  -- para quem acumula 8%, dias para o fixo (20 dias/ano).
  holiday_opening numeric(10,2) not null default 0,
  -- O que já foi trabalhado este ano antes de o sistema existir: horas
  -- para quem é pago à hora, semanas para contrato fixo. Permite entrar
  -- a meio do ano sem lançar semana a semana desde janeiro.
  opening_worked  numeric(10,2) not null default 0,
  active          boolean not null default true,
  notes           text,     -- campo livre; não entra em conta nenhuma
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_hr_emp_client on hr_employees(client_id);

-- ---------------------------------------------------------------------
-- hr_employee_hours — horas trabalhadas e férias usadas, semana a semana
-- ---------------------------------------------------------------------
create table if not exists hr_employee_hours (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references hr_employees(id) on delete cascade,
  year           integer not null,
  week_no        integer not null check (week_no between 1 and 53),
  hours          numeric(10,2) not null default 0,
  sunday_hours   numeric(10,2) not null default 0,
  -- valor lançado à mão; quando preenchido substitui o cálculo automático
  gross_override numeric(10,2),
  -- férias usadas, na unidade do funcionário: horas para quem é pago por
  -- hora, dias para quem é de contrato fixo
  holiday_hours  numeric(10,2) not null default 0,
  -- Para contrato fixo não se lançam horas: marca-se a semana como
  -- trabalhada, e é isso que alimenta o acúmulo de 20 dias / 52 semanas.
  week_worked    boolean not null default false,
  updated_by     uuid references app_users(id),
  updated_at     timestamptz not null default now(),
  unique (employee_id, year, week_no)
);

create index if not exists idx_hr_hours_lookup on hr_employee_hours(year, week_no);

-- ---------------------------------------------------------------------
-- hr_hour_submissions — horas que o cliente mandou, à espera de conferência
--
-- Fica FORA de hr_employee_hours de propósito. O que o cliente manda não é
-- um lançamento: é um PEDIDO de lançamento. Enquanto estiver aqui não entra
-- em conta nenhuma, não mexe no bruto, não aparece no controlo semanal. Só
-- passa para o outro lado quando alguém do escritório carrega em aprovar.
--
-- É isso que impede um cliente de alterar uma semana já fechada: ele não
-- escreve na tabela oficial em altura nenhuma, nem por engano nem de
-- propósito. O pior que um erro dele produz é uma linha errada nesta fila.
-- ---------------------------------------------------------------------
create table if not exists hr_hour_submissions (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  employee_id   uuid references hr_employees(id) on delete set null,
  -- Nome copiado no momento da submissão: um funcionário apagado amanhã
  -- continua a ter nome nesta fila, em vez de virar um id solto.
  employee_name text,
  year          integer not null,
  week_no       integer not null check (week_no between 1 and 53),
  hours         numeric(10,2),
  sunday_hours  numeric(10,2),
  holiday_hours numeric(10,2),
  week_worked   boolean,
  note          text,
  submitted_by  text,
  submitted_at  timestamptz not null default now(),
  status        text not null default 'pending',  -- pending | applied | dismissed
  decided_by    uuid references app_users(id),
  decided_at    timestamptz
);

create index if not exists idx_hr_subs_pending
  on hr_hour_submissions(status, submitted_at desc);

-- ---------------------------------------------------------------------
-- hr_bank_holiday_entries — feriados que foram para o banco em vez de pagos
--
-- Uma linha por pessoa, ano e feriado. O valor é lançado à mão: o sistema
-- sabe calcular quanto vale um feriado, mas quem decide o que entra no
-- saldo é quem faz a folha — pode ter sido meio dia, pode ter sido
-- acordado outro número.
--
-- Fora de hr_employee_hours de propósito: aquilo é a semana trabalhada,
-- isto é um saldo à parte, e misturar os dois faria as horas de feriado
-- entrarem no bruto.
-- ---------------------------------------------------------------------
create table if not exists hr_bank_holiday_entries (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr_employees(id) on delete cascade,
  year        integer not null,
  -- new-year | brigid | patrick | easter | may | june
  -- | august | october | christmas | stephen
  holiday_key text not null,
  hours       numeric(10,2) not null default 0,
  updated_by  uuid references app_users(id),
  updated_at  timestamptz not null default now(),
  unique (employee_id, year, holiday_key)
);

create index if not exists idx_hr_bh_lookup on hr_bank_holiday_entries(year);
