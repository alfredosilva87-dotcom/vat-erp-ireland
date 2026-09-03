-- CADASTRO COM MOVIMENTO NAO SE APAGA — a trava no BANCO.
--
-- ---------------------------------------------------------------------------
-- O QUE SE DESCOBRIU, E PORQUE ISTO E URGENTE
--
-- Apagar um cliente hoje faz CASCATA em 32 tabelas. Nao e uma figura de estilo:
-- `journal`, `sales`, `ledger_items`, `bank_transactions`, `accounting_periods`,
-- `hr_payslip`, `hr_psr`, `obligations` — a contabilidade inteira daquele
-- cliente desaparece. E `invoices` esta em `set null`, portanto as faturas de
-- COMPRA nem sequer desaparecem: ficam na base sem dono.
--
-- O ecra avisava de uma coisa so — que as faturas ficariam sem cliente — e nao
-- dizia nada dos 32. Um clique, e anos de razao vao-se.
--
-- O mesmo padrao em `hr_employees` (apaga recibos e horas) e em `bank_accounts`
-- (apaga movimentos, importacoes e fechos).
--
-- ---------------------------------------------------------------------------
-- PORQUE UM GATILHO, E NAO MUDAR AS 32 CHAVES PARA `restrict`
--
-- Mudar as chaves seria a correccao "certa" no papel e uma migracao enorme e
-- arriscada na pratica: 32 restricoes reescritas, cada uma com o seu caso de
-- uso legitimo, e nenhuma maneira de dizer ao utilizador PORQUE a exclusao
-- falhou — um erro de chave estrangeira nao explica nada a ninguem.
--
-- Um gatilho `before delete` faz o mesmo trabalho num sitio so, e pode dizer
-- em portugues corrente o que esta a acontecer e o que fazer a seguir.
--
-- E fica no BANCO, e nao no ecra, pela mesma razao que o fecho de periodo ja
-- esta: a trava que vale e a que ninguem contorna com um pedido feito a mao.
--
-- ---------------------------------------------------------------------------
-- ISTO NAO PARTE O SEED, E ISSO NAO E SORTE
--
-- `scripts/seed-demo-clients.js` ja apaga o movimento tabela a tabela ANTES de
-- apagar o cliente. Quando chega ao cliente, ele esta limpo, e o gatilho
-- deixa-o passar. Ou seja: o caminho legitimo — desfazer o movimento de
-- proposito, e so entao apagar o cadastro — continua aberto. O que fecha e o
-- caminho acidental.
--
-- Nao se abre nenhuma porta das traseiras (variavel de sessao, papel especial).
-- Uma porta dessas seria usada, e a trava passaria a ser uma sugestao.

-- A pergunta, num sitio so ----------------------------------------------------

create or replace function cadastro_tem_movimento(
  tabela text, coluna text, id uuid
) returns boolean
language plpgsql as $$
declare n bigint;
begin
  -- `to_regclass` devolve nulo em vez de rebentar quando a tabela nao existe
  -- nesta instalacao (modulo desligado, migracao por correr).
  if to_regclass('public.' || tabela) is null then return false; end if;
  execute format('select count(*) from %I where %I = $1 limit 1', tabela, coluna)
    into n using id;
  return n > 0;
end;
$$;

-- Cliente ---------------------------------------------------------------------

create or replace function guard_apagar_cliente() returns trigger
language plpgsql as $$
declare t text; c text; achou text := null;
begin
  foreach t in array array['invoices','sales','journal','ledger_items',
                           'bank_transactions','hr_employees','hr_payslip',
                           'accounting_periods']
  loop
    if cadastro_tem_movimento(t, 'client_id', old.id) then achou := t; exit; end if;
  end loop;

  if achou is not null then
    raise exception
      'This client has accounting history (%). A client with movement cannot be deleted — deactivate it instead: it stops appearing for new work and keeps explaining what already happened.', achou
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_guard_apagar_cliente on clients;
create trigger trg_guard_apagar_cliente
  before delete on clients
  for each row execute function guard_apagar_cliente();

-- Funcionario -----------------------------------------------------------------

create or replace function guard_apagar_funcionario() returns trigger
language plpgsql as $$
declare t text; achou text := null;
begin
  foreach t in array array['hr_employee_hours','hr_payslip','hr_psr_line']
  loop
    if cadastro_tem_movimento(t, 'employee_id', old.id) then achou := t; exit; end if;
  end loop;

  if achou is not null then
    raise exception
      'This employee has payroll history (%). Deactivate them instead — the payslips and hours already issued have to keep pointing at a real person.', achou
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_guard_apagar_funcionario on hr_employees;
create trigger trg_guard_apagar_funcionario
  before delete on hr_employees
  for each row execute function guard_apagar_funcionario();

-- Conta bancaria --------------------------------------------------------------

create or replace function guard_apagar_conta_bancaria() returns trigger
language plpgsql as $$
declare t text; achou text := null;
begin
  foreach t in array array['bank_transactions','bank_imports','bank_closings']
  loop
    if cadastro_tem_movimento(t, 'bank_account_id', old.id) then achou := t; exit; end if;
  end loop;

  if achou is not null then
    raise exception
      'This bank account has movement (%). Deactivate it instead — deleting it would take the reconciled statement lines with it.', achou
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_guard_apagar_conta_bancaria on bank_accounts;
create trigger trg_guard_apagar_conta_bancaria
  before delete on bank_accounts
  for each row execute function guard_apagar_conta_bancaria();

-- O interruptor que faltava a dois cadastros ----------------------------------
--
-- Se a saida e "desactivar em vez de apagar", entao todo o cadastro protegido
-- precisa de ter onde ser desactivado. `clients` ja tem `status`, e
-- `bank_accounts`, `customers`, `hr_employees` e `chart_of_accounts` ja tem
-- `active`. Faltavam estes dois.

alter table branches      add column if not exists active boolean not null default true;
alter table items_master  add column if not exists active boolean not null default true;

comment on column branches.active is
  'Filial desactivada nao aparece para lancamento novo, e continua a explicar o historico.';
comment on column items_master.active is
  'Item desactivado deixa de ser sugerido na categorizacao; as notas antigas mantem-no.';
