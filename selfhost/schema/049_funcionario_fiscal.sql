-- O funcionario ganha o que o IMPOSTO precisa de saber.
--
-- ---------------------------------------------------------------------------
-- O PPS NUMBER VOLTA, E O MATHEUS TINHA RAZAO EM O TIRAR
--
-- No sistema dele o PPS foi removido de proposito, com o comentario a
-- justificar: "isto controla que payslips sairam, nao processa pagamentos. Um
-- dado destes so se guarda se for mesmo preciso — e nao era."
--
-- Aqui e preciso. Sem PPS nao ha submissao a Revenue: e ele que identifica o
-- contribuinte no RPN e no payroll submission. A regra dele mantem-se de pe —
-- so mudou a resposta, porque mudou o que o sistema faz.
--
-- E dado pessoal sensivel. Nao entra em nenhum relatorio nem exportacao que
-- nao seja a submissao propria.
--
-- ---------------------------------------------------------------------------
-- O RPN E A VERDADE OFICIAL, E POR ISSO E SEPARADO DA SITUACAO FAMILIAR
--
-- `marital_status` e o que o escritorio SABE da pessoa, e serve para calcular
-- enquanto o RPN nao chega. `rpn_*` e o que a Revenue MANDOU, e manda sobre o
-- palpite. Guardar os dois em campos diferentes e o que permite ver que estao
-- em desacordo — juntar num so apagava a pergunta.

alter table hr_employees
  -- Identificacao fiscal
  add column if not exists pps_number text,
  add column if not exists employment_id text,   -- id do vinculo, exigido na submissao

  -- Como se tributa esta pessoa
  add column if not exists prsi_class text not null default 'A1',
  add column if not exists tax_basis text not null default 'cumulativa',
  add column if not exists marital_status text not null default 'solteiro',
  add column if not exists usc_reduced boolean not null default false,
  add column if not exists usc_exempt boolean not null default false,

  -- O que veio no RPN. Nulo = ainda nao chegou.
  add column if not exists rpn_number text,
  add column if not exists rpn_effective_from date,
  add column if not exists rpn_cutoff_cents bigint,
  add column if not exists rpn_credits_cents bigint,

  /*
   * ACUMULADO DE ABERTURA — o que faz a migracao a meio do ano ser possivel.
   *
   * Um escritorio que sai do CollSoft em Julho tem 26 semanas de PAYE, USC e
   * PRSI ja retidos. Sem estes quatro campos a base cumulativa comecava do
   * zero, e a primeira folha aqui devolvia a toda a gente o imposto do
   * semestre inteiro — um erro enorme, num numero que parece plausivel.
   */
  add column if not exists ytd_opening_gross_cents bigint not null default 0,
  add column if not exists ytd_opening_paye_cents bigint not null default 0,
  add column if not exists ytd_opening_usc_cents bigint not null default 0,
  add column if not exists ytd_opening_prsi_cents bigint not null default 0,
  add column if not exists ytd_opening_year int;

alter table hr_employees
  drop constraint if exists hr_employees_tax_basis_check;
alter table hr_employees
  add constraint hr_employees_tax_basis_check
  check (tax_basis in ('cumulativa', 'semana1', 'emergencia'));

alter table hr_employees
  drop constraint if exists hr_employees_marital_check;
alter table hr_employees
  add constraint hr_employees_marital_check
  check (marital_status in ('solteiro', 'familiaMonoparental', 'casadoUmSalario', 'casadoDoisSalarios'));

/*
 * O PPS e UNICO POR EMPRESA, e nao global.
 *
 * A mesma pessoa pode trabalhar para dois clientes do escritorio — e trabalha:
 * part-time em dois sitios e comum. Uma unicidade global recusaria o segundo
 * vinculo, que e legitimo. Dentro da mesma empresa, dois registos com o mesmo
 * PPS sao duplicado, e esse e o erro que isto apanha.
 *
 * Parcial, porque PPS nulo e o estado normal de quem ainda nao o entregou.
 */
create unique index if not exists idx_hr_emp_pps_por_cliente
  on hr_employees (client_id, pps_number)
  where pps_number is not null and pps_number <> '';

comment on column hr_employees.pps_number is
  'PPS. Dado pessoal sensivel: so sai na submissao a Revenue.';
comment on column hr_employees.tax_basis is
  'cumulativa (normal) | semana1 (Week 1/Month 1) | emergencia (sem RPN)';
comment on column hr_employees.ytd_opening_year is
  'Ano a que o acumulado de abertura pertence. Sem ele, o acumulado de 2025 seria somado a folha de 2026.';
