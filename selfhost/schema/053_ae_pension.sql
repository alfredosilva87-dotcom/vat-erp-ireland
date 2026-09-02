-- AUTO-ENROLMENT ("My Future Fund") — a pensao automatica irlandesa.
--
-- ---------------------------------------------------------------------------
-- DE ONDE VEIO A NECESSIDADE
--
-- Do payslip real dele (Sage, semana 35 de 2026): uma linha "AE Pension" de
-- 9,81 no empregado e outros 9,81 no empregador, sobre 653,85 de bruto — 1,5%
-- de cada lado. Era a UNICA linha do recibo que o motor nao sabia fazer; todo o
-- imposto ja batia ao centimo.
--
-- ---------------------------------------------------------------------------
-- A COISA QUE MAIS SE ERRA: NAO HA DESGRAVACAO FISCAL
--
-- Ao contrario de um PRSA, a contribuicao de auto-enrolment **nao reduz o
-- rendimento tributavel**. Quem a trata como uma pensao normal desconta-a antes
-- do imposto e da um PAYE mais baixo do que o devido — todas as semanas, a toda
-- a gente, sem dar erro nenhum.
--
-- O proprio payslip prova a regra: GROSS PAY 22.241,26 e TAXABLE PAY 22.241,26,
-- iguais ao centimo, com 333,66 de AE Pension ja descontados no acumulado. O
-- Estado poe um bonus por cima em vez de dar desgravacao.
--
-- Por isso a AE sai do LIQUIDO, depois de PAYE, USC e PRSI — e nunca da base.
--
-- ---------------------------------------------------------------------------
-- AS TAXAS SOBEM POR DEGRAUS, E POR ISSO SAO CADASTRO
--
-- O esquema comeca em 1,5% e sobe de tres em tres anos ate 6%. Uma taxa escrita
-- no codigo obrigava a alterar o sistema em cada degrau — e sao seis degraus ao
-- longo de dez anos. Mesma decisao das tabelas fiscais.

create table if not exists hr_ae_rate (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique,

  employee_bps int not null,          -- 1,50% = 150
  employer_bps int not null,
  state_bps int not null,             -- o bonus do Estado; nao passa pela folha

  /*
   * Quem entra, por lei. Sao os tres testes que decidem a inscricao automatica,
   * e ficam aqui porque tambem mudam: o limiar de rendimento e a idade sao
   * politica, nao aritmetica.
   */
  min_annual_earnings_cents bigint not null,
  earnings_cap_cents bigint not null,  -- contribui-se ate este bruto anual
  min_age int not null,
  max_age int not null,

  confirmed_at timestamptz,
  source text not null default '',
  created_at timestamptz not null default now()
);

alter table hr_employees
  /*
   * `null` = ainda nao se decidiu, e a folha aplica o teste da lei.
   * `true`/`false` = alguem decidiu, e a decisao MANDA sobre o teste.
   *
   * Tres estados e nao dois porque "nao inscrito" e "ainda nao avaliado" sao
   * coisas diferentes: a primeira e uma escolha da pessoa (opt-out, ou ja tem
   * pensao ocupacional), a segunda e trabalho por fazer.
   */
  add column if not exists ae_enrolled boolean,
  add column if not exists ae_opt_out_date date,
  -- Quem ja tem pensao da empresa fica FORA do auto-enrolment, por lei.
  add column if not exists has_occupational_pension boolean not null default false;

comment on column hr_employees.ae_enrolled is
  'null = por avaliar (aplica-se o teste da lei) · true/false = decisao tomada, e manda sobre o teste';

insert into hr_ae_rate (
  effective_from, employee_bps, employer_bps, state_bps,
  min_annual_earnings_cents, earnings_cap_cents, min_age, max_age, source
) values
  ('2026-01-01', 150, 150, 50, 2000000, 8000000, 23, 60,
   'Fase 1 do auto-enrolment (anos 1-3): 1,5% + 1,5% + 0,5%. Confere com o payslip Sage de 2026 (9,81 sobre 653,85). POR CONFERIR contra a publicacao oficial.')
on conflict (effective_from) do nothing;

-- O payslip guarda a AE dos dois lados. Sem isto, um recibo reimpresso um ano
-- depois nao conseguia mostrar a linha que a pessoa viu na altura.
alter table hr_payslip
  add column if not exists ae_ee_cents bigint not null default 0,
  add column if not exists ae_er_cents bigint not null default 0;
