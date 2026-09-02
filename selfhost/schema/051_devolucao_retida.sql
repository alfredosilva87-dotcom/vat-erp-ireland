-- SEGURAR uma devolucao de imposto para o periodo seguinte.
--
-- ---------------------------------------------------------------------------
-- O QUE ELE DESCREVEU
--
-- "ouvi algo sobre a empresa decidir se devolve ou nao o valor que o revenue
-- devolveu, se na proxima semana ou nesta semana... os campos deveriam ser
-- editaveis e gravar a informacao pra ter base e recalculo automatico dessas
-- devolucoes de creditos pelo fato de ter os 40 emergenciais"
--
-- O caso real por tras disto: alguem esteve em base de EMERGENCIA (sem RPN),
-- onde se retem de propósito a mais. Quando o RPN chega e a pessoa passa a
-- cumulativa, o cumulativo calcula que ela pagou imposto a mais e **devolve**
-- — as vezes varias centenas de euros de uma vez, numa unica semana.
--
-- Essa devolucao sai do bolso do EMPREGADOR na hora: ele paga a mais no
-- liquido e desconta depois no que remete a Revenue. Uma devolucao grande numa
-- semana de tesouraria apertada e um problema real, e por isso ha a decisao de
-- a adiar.
--
-- ---------------------------------------------------------------------------
-- POR QUE ISTO E UM REGISTO E NAO UM CAMPO CALCULADO
--
-- Ele pediu "gravar a informacao pra ter base e recalculo automatico". A
-- decisao de segurar e um ACTO de alguem, numa data, por uma razao — nao se
-- deduz de numero nenhum. Sem a gravar, reabrir e recalcular a folha voltava a
-- pagar a devolucao que alguem tinha decidido segurar, e a decisao perdia-se.
--
-- O recalculo continua automatico: o cumulativo ve o retido acumulado ainda
-- alto e volta a apurar a devolucao no periodo seguinte, sozinho. Nao e preciso
-- guardar o VALOR seguro — so a decisao. Guardar o valor criava uma segunda
-- verdade que diverge no dia em que a tabela fiscal mudar.

create table if not exists hr_refund_hold (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  employee_id uuid not null references hr_employees(id) on delete cascade,
  year int not null,
  period_no int not null,
  freq_type text not null check (freq_type in ('weekly','fortnightly','monthly')),

  -- Porque se segurou. Texto livre e obrigatorio: uma decisao de tesouraria sem
  -- motivo escrito e indefensavel tres meses depois.
  reason text not null,
  created_by uuid,
  created_at timestamptz not null default now(),

  -- Uma decisao por pessoa e periodo.
  unique (employee_id, year, period_no, freq_type)
);

create index if not exists idx_refund_hold_periodo
  on hr_refund_hold(client_id, year, period_no, freq_type);
