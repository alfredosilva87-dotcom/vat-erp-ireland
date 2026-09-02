-- As TABELAS FISCAIS viram cadastro.
--
-- ---------------------------------------------------------------------------
-- POR QUE NO BANCO E NAO NO CODIGO
--
-- Pedido do Alfredo (2026-09-02): "cria algo que possa alterar esses impostos
-- quando as regras mudarem, precisa ser cadastrado e nao na raiz".
--
-- Ele tem razao, e a razao e operacional. As taxas irlandesas mudam TODOS os
-- anos no Orcamento de Outubro, e o PRSI ja mudou A MEIO DO ANO duas vezes
-- seguidas (01-10-2024 e 01-10-2025). Com os numeros no codigo, cada mudanca
-- exige alterar o ficheiro, buildar e reimplantar em cada instalacao — e a
-- folha de Janeiro nao espera por isso.
--
-- No cadastro, quem percebe de imposto altera a tabela e a folha seguinte ja
-- sai certa, sem passar por ninguem.
--
-- ---------------------------------------------------------------------------
-- O CODIGO CONTINUA A TER A SEMENTE, E ISSO NAO E DUPLICACAO
--
-- `lib/hr/fiscal/tabelas.ts` continua a existir como SEMENTE e recurso: uma
-- instalacao nova nasce com uma tabela, e uma leitura que falhe nao deixa a
-- folha sem numeros. O banco MANDA sempre que tem linha para o ano.
--
-- ---------------------------------------------------------------------------
-- `confirmado_em` E O QUE IMPEDE UM PALPITE DE PASSAR POR LEI
--
-- Uma tabela por confirmar CALCULA na mesma — recusar deixaria o escritorio
-- sem folha, que e pior — mas o resultado sai marcado e o ecra mostra o aviso.
-- Um numero de imposto errado nao da erro: da um liquido plausivel e uma
-- divida a Revenue que aparece meses depois.

create table if not exists hr_tax_year (
  year int primary key,

  -- PAYE
  rate_standard_bps int not null default 2000,   -- 20,00% = 2000
  rate_higher_bps   int not null default 4000,
  cutoff_single_cents        bigint not null,
  cutoff_lone_parent_cents   bigint not null,
  cutoff_married_one_cents   bigint not null,
  cutoff_married_two_cents   bigint not null,
  cutoff_transfer_max_cents  bigint not null,    -- quanto o 2.o salario acresce
  credit_personal_single_cents  bigint not null,
  credit_personal_married_cents bigint not null,
  credit_employee_cents         bigint not null,
  credit_lone_parent_cents      bigint not null,

  -- Emergency basis: sem RPN
  emergency_weeks_with_cutoff int not null default 4,
  emergency_weekly_cutoff_cents bigint not null,

  -- USC
  usc_exemption_annual_cents bigint not null,
  usc_reduced_limit_cents    bigint not null,

  -- A procedencia. Sem isto ninguem sabe se o numero foi conferido ou herdado.
  confirmed_at timestamptz,
  confirmed_by uuid,
  source text not null default '',
  notes text,
  updated_at timestamptz not null default now()
);

-- As bandas de USC: quantas forem, na ordem que forem. Tabela e nao colunas,
-- porque o numero de bandas ja mudou na Irlanda e ha de voltar a mudar.
create table if not exists hr_usc_band (
  id uuid primary key default gen_random_uuid(),
  year int not null references hr_tax_year(year) on delete cascade,
  -- `false` = bandas normais; `true` = as reduzidas (cartao medico, 70+).
  reduced boolean not null default false,
  ord int not null,
  -- Limite SUPERIOR anual da banda. NULL = daqui para cima.
  upto_cents bigint,
  rate_bps int not null,
  unique (year, reduced, ord)
);

-- O PRSI tem DATA, e e por isso que e uma tabela a parte: uma alteracao de
-- Outubro nao pode reescrever o que ja foi pago em Setembro.
create table if not exists hr_prsi_rate (
  id uuid primary key default gen_random_uuid(),
  year int not null references hr_tax_year(year) on delete cascade,
  effective_from date not null,
  employee_bps int not null,
  employee_exempt_weekly_cents bigint not null,
  credit_max_cents bigint not null,
  credit_upto_weekly_cents bigint not null,
  employer_lower_bps int not null,
  employer_higher_bps int not null,
  employer_threshold_weekly_cents bigint not null,
  unique (year, effective_from)
);

create index if not exists idx_usc_band_year on hr_usc_band(year, reduced, ord);
create index if not exists idx_prsi_rate_year on hr_prsi_rate(year, effective_from);

-- ---------------------------------------------------------------- semente
-- Idempotente: `on conflict do nothing`. Quem ja editou a tabela no ecra NAO a
-- ve voltar ao valor de fabrica na actualizacao seguinte — que seria a forma
-- mais rapida de perder a confianca no cadastro.
insert into hr_tax_year (
  year, cutoff_single_cents, cutoff_lone_parent_cents, cutoff_married_one_cents,
  cutoff_married_two_cents, cutoff_transfer_max_cents,
  credit_personal_single_cents, credit_personal_married_cents,
  credit_employee_cents, credit_lone_parent_cents,
  emergency_weekly_cutoff_cents, usc_exemption_annual_cents, usc_reduced_limit_cents, source
) values
  (2025, 4400000, 4800000, 5300000, 5300000, 3500000,
   200000, 400000, 200000, 190000,
   84615, 1300000, 6000000,
   'Orcamento 2025 + PRSI de 01-10-2025. POR CONFERIR contra revenue.ie.'),
  (2026, 4400000, 4800000, 5300000, 5300000, 3500000,
   200000, 400000, 200000, 190000,
   84615, 1300000, 6000000,
   'HERDADA DE 2025 — o Orcamento 2026 NAO foi aplicado. Conferir antes da primeira folha.')
on conflict (year) do nothing;

insert into hr_usc_band (year, reduced, ord, upto_cents, rate_bps)
select y.year, b.reduced, b.ord, b.upto_cents, b.rate_bps
from (values (2025), (2026)) as y(year)
cross join (values
  (false, 1, 1201200::bigint, 50),
  (false, 2, 2738200::bigint, 200),
  (false, 3, 7004400::bigint, 300),
  (false, 4, null::bigint,    800),
  (true,  1, 1201200::bigint, 50),
  (true,  2, null::bigint,    200)
) as b(reduced, ord, upto_cents, rate_bps)
on conflict (year, reduced, ord) do nothing;

insert into hr_prsi_rate (
  year, effective_from, employee_bps, employee_exempt_weekly_cents,
  credit_max_cents, credit_upto_weekly_cents,
  employer_lower_bps, employer_higher_bps, employer_threshold_weekly_cents
) values
  (2025, '2025-01-01', 410, 35200, 1200, 42400, 890, 1115, 49600),
  (2025, '2025-10-01', 420, 35200, 1200, 42400, 900, 1125, 49600),
  (2026, '2026-01-01', 420, 35200, 1200, 42400, 900, 1125, 49600)
on conflict (year, effective_from) do nothing;
