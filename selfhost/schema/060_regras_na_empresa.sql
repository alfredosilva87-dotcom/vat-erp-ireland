-- AS REGRAS DE PAGAMENTO MUDAM-SE DE TABELA — e a razao e uma so.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTAVA ERRADO NA 059
--
-- A migracao anterior pos `sunday_mode`, `overtime_*` e `holiday_*` em
-- `hr_client_config`. Essa tabela e POR BLOCO DE FREQUENCIA — a chave unica
-- dela e `(client_id, freq_type)`, e uma empresa pode ter tres linhas: semanal,
-- quinzenal e mensal.
--
-- Ou seja: "aqui o domingo paga-se a dobrar" ficava gravado tres vezes, e nada
-- obrigava as tres a concordarem. O mesmo funcionario, mudado de semanal para
-- mensal, mudava de regra de domingo sem ninguem tocar em nada. E o ecra que
-- fosse gravar teria de escolher UMA das linhas para escrever — e qualquer
-- escolha estaria errada em dois tercos dos casos.
--
-- A regra e da EMPRESA. `hr_client` tem `client_id` como chave primaria: uma
-- linha por empresa, que e exactamente o que uma frase como "aqui o domingo
-- paga-se a dobrar" quer dizer.
--
-- ---------------------------------------------------------------------------
-- PORQUE SE PODE APAGAR DA OUTRA TABELA SEM MEDO
--
-- As colunas da 059 nasceram ha dias e NUNCA foram escritas: nao ha ecra que
-- as grave, nao ha rota que lhes toque, e a leitura (`regrasPara`) recebe a
-- configuracao por parametro e ainda nao esta ligada a base. Os valores em
-- todas as linhas sao os padroes. Nao ha nada a salvar.
--
-- Mesmo assim copia-se antes de apagar: e barato, e se alguem tiver corrido a
-- 059 e mexido a mao num cliente, esse valor sobrevive.

alter table hr_client
  -- 'rate'       — o premio vem do campo `sunday_rate` do funcionario.
  -- 'multiplier' — a empresa tem multiplicador (1.5, 2.0) sobre a taxa hora.
  add column if not exists sunday_mode text not null default 'rate'
    check (sunday_mode in ('rate','multiplier')),
  add column if not exists sunday_multiplier numeric(6,3),
  -- Nulo em qualquer um dos dois quer dizer "esta empresa nao tem regra de
  -- horas extras" — e nao "extras a zero", que seria trabalho por pagar.
  add column if not exists overtime_after_hours numeric(6,2),
  add column if not exists overtime_multiplier  numeric(6,3),
  -- Os padroes sao o MINIMO legal irlandes; a empresa pode dar mais.
  add column if not exists holiday_accrual_pct numeric(6,3) not null default 8.0,
  add column if not exists holiday_days_year   numeric(6,2) not null default 20.0;

-- Se a 059 chegou a correr, traz-se o que la estiver diferente do padrao.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'hr_client_config' and column_name = 'sunday_mode'
  ) then
    update hr_client c set
      sunday_mode          = coalesce(f.sunday_mode, c.sunday_mode),
      sunday_multiplier    = coalesce(f.sunday_multiplier, c.sunday_multiplier),
      overtime_after_hours = coalesce(f.overtime_after_hours, c.overtime_after_hours),
      overtime_multiplier  = coalesce(f.overtime_multiplier, c.overtime_multiplier),
      holiday_accrual_pct  = coalesce(f.holiday_accrual_pct, c.holiday_accrual_pct),
      holiday_days_year    = coalesce(f.holiday_days_year, c.holiday_days_year)
    from (
      -- Uma linha por empresa. Havendo tres em desacordo, fica a mais recente:
      -- e a unica escolha defensavel, e o ecra passa a ter um sitio so.
      select distinct on (client_id) *
        from hr_client_config order by client_id, updated_at desc
    ) f
    where f.client_id = c.client_id;

    alter table hr_client_config
      drop column if exists sunday_mode,
      drop column if exists sunday_multiplier,
      drop column if exists overtime_after_hours,
      drop column if exists overtime_multiplier,
      drop column if exists holiday_accrual_pct,
      drop column if exists holiday_days_year;
  end if;
end $$;

comment on column hr_client.sunday_mode is
  'rate = premio pelo campo do funcionario; multiplier = regra da empresa sobre a taxa hora.';
comment on column hr_client.sunday_multiplier is
  'Multiplicador sobre a taxa hora quando sunday_mode = multiplier. 2.0 = a dobrar.';
comment on column hr_client.overtime_after_hours is
  'Horas semanais a partir das quais conta como extra. Nulo = esta empresa nao tem regra de extras.';
comment on column hr_client.holiday_accrual_pct is
  'Percentagem das horas trabalhadas que acumula ferias. 8 e o minimo legal irlandes.';
comment on column hr_client.holiday_days_year is
  'Dias de ferias por ano para contrato fixo. 20 e o minimo legal.';
