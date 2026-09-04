-- AS REGRAS DE PAGAMENTO QUE MUDAM DE EMPRESA PARA EMPRESA.
--
-- ---------------------------------------------------------------------------
-- O QUE FALTAVA, E O QUE ISSO CUSTAVA
--
-- O calculo do bruto era literalmente este:
--
--     horas × hourly_rate  +  horas_domingo × (sunday_rate || hourly_rate)
--
-- Ou seja: o premio de domingo vivia num campo POR FUNCIONARIO, escrito a mao
-- em cada ficha. Nao ha regra nenhuma no sistema — e quem deixasse esse campo
-- em branco pagava o domingo ao preco de um dia normal, EM SILENCIO. A lei
-- irlandesa (Organisation of Working Time Act 1997, s.14) da direito a
-- compensacao por trabalho ao domingo; o produto permitia nao a pagar sem dizer
-- nada.
--
-- E ferias eram 8% e 20 dias, cravados no codigo, para toda a gente. Mas ha
-- empresas que dao MAIS do que o minimo legal — e essas nao cabiam no sistema.
--
-- ---------------------------------------------------------------------------
-- PORQUE POR EMPRESA, E NAO GLOBAL NEM POR FUNCIONARIO
--
-- Global estaria errado: sao 35 clientes diferentes, cada um com o seu acordo.
-- Por funcionario e o que ja existe, e e o que falha — obriga a repetir a mesma
-- regra em cada ficha, e a esquece-la numa delas e so descobrir no recibo.
--
-- A regra e da EMPRESA porque e assim que ela existe no mundo: "aqui o domingo
-- paga-se a dobrar" e uma frase sobre a empresa, nao sobre uma pessoa.
--
-- O campo por funcionario CONTINUA A EXISTIR e continua a ganhar quando esta
-- preenchido: ha sempre o caso do contrato individual diferente do resto da
-- casa, e apagar essa possibilidade para simplificar seria trocar um problema
-- por outro.
--
-- ---------------------------------------------------------------------------
-- OS PADROES SAO OS DA LEI, E NAO ZERO
--
-- Uma coluna nova a zero mudaria o calculo de toda a gente no dia em que fosse
-- criada. Os padroes aqui sao exactamente o comportamento actual: 8% e 20 dias
-- (o minimo legal irlandes), e domingo pelo campo do funcionario.

alter table hr_client_config
  -- 'rate'       — como hoje: o premio vem do campo `sunday_rate` do funcionario.
  -- 'multiplier' — a empresa tem um multiplicador (1.5, 2.0) sobre a taxa hora.
  add column if not exists sunday_mode text not null default 'rate'
    check (sunday_mode in ('rate','multiplier')),
  add column if not exists sunday_multiplier numeric(6,3),

  -- Horas extras: a partir de quantas horas por semana, e a que multiplicador.
  -- Nulo em qualquer um dos dois quer dizer "esta empresa nao tem regra de
  -- horas extras" — e nao "extras a zero", que seria trabalho por pagar.
  add column if not exists overtime_after_hours numeric(6,2),
  add column if not exists overtime_multiplier  numeric(6,3),

  -- Ferias. Os padroes sao o MINIMO legal; a empresa pode dar mais.
  add column if not exists holiday_accrual_pct numeric(6,3) not null default 8.0,
  add column if not exists holiday_days_year   numeric(6,2) not null default 20.0;

comment on column hr_client_config.sunday_mode is
  'rate = premio pelo campo do funcionario (comportamento historico); multiplier = regra da empresa.';
comment on column hr_client_config.sunday_multiplier is
  'Multiplicador sobre a taxa hora quando sunday_mode = multiplier. 2.0 = a dobrar.';
comment on column hr_client_config.overtime_after_hours is
  'Horas semanais a partir das quais conta como extra. Nulo = esta empresa nao tem regra de extras.';
comment on column hr_client_config.holiday_accrual_pct is
  'Percentagem das horas trabalhadas que acumula ferias. 8 e o minimo legal irlandes; ha empresas que dao mais.';
comment on column hr_client_config.holiday_days_year is
  'Dias de ferias por ano para contrato fixo. 20 e o minimo legal.';
