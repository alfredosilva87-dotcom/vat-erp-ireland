-- =====================================================================
-- Camada de tenant: empresas (escritorios) + licenca de ativacao.
-- ---------------------------------------------------------------------
-- Ja aplicado em producao (projeto qimcehiwxalhvbcpyzvg) via MCP
-- apply_migration. Este arquivo documenta a migracao no historico do repo.
--
-- Por que so clients e app_users ganham company_id: todas as demais tabelas
-- de dados penduram em clients via client_id (branches, chart_of_accounts,
-- invoices, obligations, sales, client_item_accounts; invoice_items chega
-- por invoice_id). Escopar a lista de clientes ja isola o tenant inteiro.
--
-- vat_categories, credit_rules e items_master seguem GLOBAIS de proposito:
-- sao referencia nacional irlandesa, nao dado de cliente.
-- =====================================================================

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,          -- identificador digitado no login
  active boolean not null default true,
  license_key text,
  license_expires_at date,
  contact_email text,
  notes text,
  created_at timestamptz not null default now()
);

alter table clients   add column if not exists company_id uuid references companies(id);
alter table app_users add column if not exists company_id uuid references companies(id);

create index if not exists idx_clients_company on clients(company_id);
create index if not exists idx_app_users_company on app_users(company_id);

-- Backfill: o que ja existia pertence a empresa padrao, entao o
-- comportamento anterior segue identico depois da migracao.
insert into companies (name, slug, active, license_expires_at, contact_email)
select 'Precise Tax and Accounting Solutions', 'precisetax', true,
       (current_date + interval '1 year')::date, 'alfredo.silvajr87@gmail.com'
where not exists (select 1 from companies where slug = 'precisetax');

update clients   set company_id = (select id from companies where slug = 'precisetax') where company_id is null;
update app_users set company_id = (select id from companies where slug = 'precisetax') where company_id is null;
