-- A SUBMISSAO DE FOLHA A REVENUE (PSR), guardada como FACTO.
--
-- ---------------------------------------------------------------------------
-- O QUE MUDOU NA IRLANDA, E POR QUE ISTO PRECISA DE EXISTIR
--
-- Desde a PAYE Modernisation (2019) o empregador comunica CADA pagamento, no
-- dia em que paga ou antes. Nao ha resumo anual: o P35 acabou. Quem vem de um
-- sistema antigo traz o habito de "fechar no fim do mes", e esse habito e uma
-- infraccao a cada semana.
--
-- ---------------------------------------------------------------------------
-- ISTO NAO FALA COM O ROS, E E DELIBERADO
--
-- Enviar exige o certificado digital do escritorio e assinar cada pedido com
-- ele. E uma credencial, e uma credencial nao entra num sistema sem que quem
-- manda nela decida como.
--
-- O que o escritorio nao tem hoje nao e um canal — ja submete pelo ROS a mao.
-- O que lhe falta e saber ANTES que a submissao esta completa, e ficar com
-- registo do que comunicou. E isso que estas duas tabelas fazem.
--
-- ---------------------------------------------------------------------------
-- POR QUE SE COPIA O NUMERO EM VEZ DE O IR BUSCAR AO PAYSLIP
--
-- As linhas guardam os valores COMUNICADOS, e nao uma referencia ao payslip.
-- Parece duplicacao e nao e: o que foi dito a Revenue e um facto historico. Se
-- amanha alguem reabrir a semana e corrigir um payslip, o que foi submetido
-- naquele dia continua a ter sido aquilo — e a diferenca entre os dois e
-- exactamente o que uma submissao correctiva tem de explicar.
--
-- Sem a copia, reabrir um payslip reescrevia em silencio a historia do que se
-- comunicou, e ficava impossivel saber que havia uma correccao por fazer.

create table if not exists hr_psr (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,

  year int not null,
  period_no int not null,
  freq_type text not null check (freq_type in ('weekly','fortnightly','monthly')),
  pay_date date not null,

  -- Identificacao do empregador na Revenue, copiada do cadastro no momento da
  -- submissao: se o numero mudar depois, o que foi enviado nao muda.
  employer_number text,

  -- Totais comunicados, em centimos.
  gross_cents bigint not null default 0,
  paye_cents bigint not null default 0,
  usc_cents bigint not null default 0,
  prsi_ee_cents bigint not null default 0,
  prsi_er_cents bigint not null default 0,
  insurable_weeks int not null default 0,

  /*
   * `draft`  — montada, ainda nao comunicada.
   * `sent`   — alguem submeteu pelo ROS e registou aqui o comprovativo.
   * `void`   — desistiu-se desta; fica para nao abrir um buraco no historico.
   */
  status text not null default 'draft' check (status in ('draft','sent','void')),

  -- O comprovativo do ROS. E TEXTO LIVRE de proposito: quem o cola e uma pessoa
  -- a ler o ecra da Revenue, e inventar um formato so faria a pessoa desistir
  -- de o registar.
  ros_reference text,
  submitted_at timestamptz,
  submitted_by uuid,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Uma submissao por periodo e por bloco. Duas seria comunicar a dobrar.
  unique (client_id, year, period_no, freq_type)
);

create index if not exists idx_psr_cliente on hr_psr(client_id, year);

create table if not exists hr_psr_line (
  id uuid primary key default gen_random_uuid(),
  psr_id uuid not null references hr_psr(id) on delete cascade,
  employee_id uuid not null references hr_employees(id) on delete restrict,

  -- Como a pessoa foi identificada A REVENUE. Copiado, nao referenciado.
  pps_number text,
  employment_id text,
  employee_name text not null,

  gross_cents bigint not null default 0,
  taxable_cents bigint not null default 0,
  paye_cents bigint not null default 0,
  usc_cents bigint not null default 0,
  prsi_ee_cents bigint not null default 0,
  prsi_er_cents bigint not null default 0,
  prsi_class text,
  insurable_weeks int not null default 0,
  ae_ee_cents bigint not null default 0,
  ae_er_cents bigint not null default 0,

  created_at timestamptz not null default now(),
  unique (psr_id, employee_id)
);

create index if not exists idx_psr_line_psr on hr_psr_line(psr_id);

/*
 * O funcionario nao se apaga depois de comunicado — `on delete restrict`.
 *
 * As outras tabelas do RH usam `cascade`, porque apagar alguem que nunca
 * entrou em folha nenhuma e limpeza. Aqui nao: o que foi dito a Revenue sobre
 * uma pessoa tem de continuar a poder ser explicado, e um registo que aponta
 * para um funcionario que ja nao existe nao se explica a ninguem.
 *
 * Quem sai marca-se como inactivo, que e o que o modulo ja fazia.
 */

/*
 * SUBMETIDA NAO SE ALTERA — a mesma disciplina do payslip fechado (050) e do
 * cadeado do razao (039).
 *
 * Um numero ja comunicado a Revenue nao pode mudar por baixo. Corrigir faz-se
 * com uma submissao NOVA, que e o que a propria Revenue espera; alterar esta
 * apagava a prova de que houve uma correccao.
 *
 * O gatilho deixa passar `sent -> void`, senao nao havia como desistir de uma
 * submissao registada por engano.
 */
create or replace function psr_submetida_nao_muda() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'sent' then
      raise exception 'Submissao ja comunicada (periodo %/%) nao se apaga.', old.period_no, old.year;
    end if;
    return old;
  end if;

  if old.status = 'sent' and new.status = 'sent' then
    raise exception 'Submissao ja comunicada (periodo %/%) nao se altera. Faca uma correctiva.',
      old.period_no, old.year;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_psr_submetida_nao_muda on hr_psr;
create trigger trg_psr_submetida_nao_muda
  before update or delete on hr_psr
  for each row execute function psr_submetida_nao_muda();

comment on column hr_psr.ros_reference is
  'Comprovativo devolvido pelo ROS, colado a mao. Texto livre: quem o le e uma pessoa.';
comment on column hr_psr_line.insurable_weeks is
  'Semanas seguraveis. Nao mexem em imposto — mexem no que a pessoa tem direito a receber do Estado.';
