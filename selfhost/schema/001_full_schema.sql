-- =====================================================================
-- VAT ERP Ireland — consolidated schema, pulled directly from the
-- production Supabase project (qimcehiwxalhvbcpyzvg) via
-- supabase_migrations.schema_migrations on 2026-08-07.
--
-- This is the AUTHORITATIVE schema — more complete than the repo's
-- db/*.sql files, which drifted out of sync with what was actually
-- applied in production over time. Apply this (in order) to a fresh
-- self-hosted Postgres to get an exact structural replica.
--
-- Does NOT include storage.buckets seeding (see 002_storage_bucket.sql,
-- applied separately after the Storage service has initialized its own
-- schema) and does NOT include any real client data (invoices, sales,
-- clients) — only structure + reference data (vat_categories,
-- credit_rules) + the one admin app_users row.
-- =====================================================================

-- ============ 20260726230231_erp_initial_schema ============
create extension if not exists pgcrypto;

-- ---------- Clients (managed companies) ----------
create table if not exists clients (
  id            uuid primary key default gen_random_uuid(),
  client_code   text,
  name          text not null,
  vat_number    text,
  tax_reg_no    text,
  activity_code text default 'GENERIC',
  activity_label text,
  email         text,
  phone         text,
  address       text,
  notes         text,
  created_at    timestamptz not null default now()
);

-- ---------- Branches / stores (filiais) ----------
create table if not exists branches (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  code        text,
  name        text not null,
  address     text,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_branches_client on branches(client_id);

-- ---------- Chart of accounts (plano de contas) ----------
create table if not exists chart_of_accounts (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  description text not null,
  parent_code text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists idx_coa_code on chart_of_accounts(code);

-- ---------- VAT rate base ----------
do $$ begin
  create type vat_rate_type as enum ('standard','reduced','second_reduced','livestock','zero','exempt');
exception when duplicate_object then null;
end $$;
create table if not exists vat_categories (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  description   text not null,
  keywords      text[] not null default '{}',
  vat_rate      numeric(4,1) not null,
  rate_type     vat_rate_type not null,
  effective_from date not null default '2000-01-01',
  effective_to  date,
  active        boolean not null default true,
  updated_at    timestamptz not null default now()
);

-- ---------- Credit rules (per activity) ----------
create table if not exists credit_rules (
  id                 uuid primary key default gen_random_uuid(),
  activity_code      text not null default '*',
  vat_category_id    uuid references vat_categories(id) on delete cascade,
  match_keywords     text[] not null default '{}',
  deductible_default boolean not null default true,
  rationale          text,
  priority           int not null default 100,
  active             boolean not null default true
);
create index if not exists idx_credit_rules_activity on credit_rules(activity_code, active);

-- ---------- Items master (de-para / learning cache) ----------
create table if not exists items_master (
  id                uuid primary key default gen_random_uuid(),
  norm_key          text not null,
  canonical_name    text not null,
  category_code     text,
  category_name     text,
  expected_vat_rate numeric(4,1),
  account_code      text,
  account_name      text,
  occurrences       int not null default 1,
  first_seen        timestamptz not null default now(),
  last_seen         timestamptz not null default now()
);
create unique index if not exists idx_items_master_key on items_master(norm_key);

-- ---------- Invoices (purchases / entradas) ----------
do $$ begin
  create type doc_type as enum ('invoice','receipt','other');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type invoice_status as enum ('pending_review','reviewed','error');
exception when duplicate_object then null;
end $$;

create table if not exists invoices (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients(id) on delete set null,
  branch_id       uuid references branches(id) on delete set null,
  client_code     text,
  client_name     text,
  activity_code   text,
  supplier_name   text,
  store_name      text,
  supplier_vat    text,
  invoice_number  text,
  barcode         text,
  invoice_date    date,
  invoice_time    text,
  doc_type        text default 'invoice',
  currency        text not null default 'EUR',
  total_net       numeric(14,2),
  total_vat       numeric(14,2),
  total_gross     numeric(14,2),
  total_credit    numeric(14,2) not null default 0,
  engine          text,
  original_filename text,
  document_path   text,
  item_count      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_invoices_client on invoices(client_id);
create index if not exists idx_invoices_branch on invoices(branch_id);
create index if not exists idx_invoices_date on invoices(invoice_date);

-- ---------- Invoice items ----------
create table if not exists invoice_items (
  id                    uuid primary key default gen_random_uuid(),
  invoice_id            uuid not null references invoices(id) on delete cascade,
  master_item_id        uuid references items_master(id) on delete set null,
  description           text not null,
  quantity              numeric(14,3),
  net_amount            numeric(14,2),
  vat_rate_on_invoice   numeric(4,1),
  vat_amount_on_invoice numeric(14,2),
  expected_vat_rate     numeric(4,1),
  category_code         text,
  category_name         text,
  account_code          text,
  account_name          text,
  take_credit           boolean not null default false,
  credit_value          numeric(14,2) not null default 0
);
create index if not exists idx_items_invoice on invoice_items(invoice_id);

-- ---------- Obligations (VAT3 bi-monthly + RTD) ----------
do $$ begin
  create type obligation_kind as enum ('VAT3','RTD');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type obligation_status as enum ('open','filed');
exception when duplicate_object then null;
end $$;
create table if not exists obligations (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients(id) on delete cascade,
  kind              obligation_kind not null,
  period_label      text not null,
  period_start      date not null,
  period_end        date not null,
  due_date          date not null,
  year              int not null,
  status            obligation_status not null default 'open',
  vat_on_sales      numeric(14,2),
  vat_on_purchases  numeric(14,2),
  net               numeric(14,2),
  notes             text,
  filed_at          timestamptz
);
create index if not exists idx_obligations_client_year on obligations(client_id, year);

-- ---------- Sales (emitted invoices -> VAT on sales / T1) ----------
create table if not exists sales (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  branch_id   uuid references branches(id) on delete set null,
  entry_date  date not null,
  doc_number  text,
  customer    text,
  net_amount  numeric(14,2),
  vat_rate    numeric(4,1),
  vat_amount  numeric(14,2) not null default 0,
  account_code text,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_sales_client on sales(client_id);
create index if not exists idx_sales_date on sales(entry_date);

alter table clients            enable row level security;
alter table branches           enable row level security;
alter table chart_of_accounts  enable row level security;
alter table vat_categories     enable row level security;
alter table credit_rules       enable row level security;
alter table items_master       enable row level security;
alter table invoices           enable row level security;
alter table invoice_items      enable row level security;
alter table obligations        enable row level security;
alter table sales              enable row level security;

-- ============ 20260727085105_auth_app_users ============
create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  name          text,
  password_hash text not null,
  role          text not null default 'user',
  active        boolean not null default true,
  must_change   boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table app_users enable row level security;

-- NOTE: the original migration seeded one hard-coded admin row here. It was
-- removed on purpose: this file is versioned in the app repo, and a password
-- hash does not belong in git. `scripts/install.js` creates the admin user
-- after the stack is up, from the e-mail and password typed at install time
-- (hashed by pgcrypto's bcrypt, which bcryptjs verifies).

-- ============ 20260727101529_add_posting_date_to_invoices ============
alter table public.invoices
  add column if not exists posting_date date;

update public.invoices
  set posting_date = coalesce(invoice_date, created_at::date)
  where posting_date is null;

alter table public.invoices
  alter column posting_date set default (now() at time zone 'utc')::date;

create index if not exists invoices_posting_date_idx on public.invoices (client_id, posting_date);

-- ============ 20260727115334_chart_of_accounts_per_client_and_learned ============
alter table public.chart_of_accounts
  add column if not exists client_id uuid references public.clients(id) on delete cascade;

create unique index if not exists chart_of_accounts_client_code_idx
  on public.chart_of_accounts (client_id, code);

create index if not exists chart_of_accounts_client_idx
  on public.chart_of_accounts (client_id);

create table if not exists public.client_item_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  norm_key text not null,
  account_code text,
  account_name text,
  occurrences integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (client_id, norm_key)
);

alter table public.client_item_accounts enable row level security;
alter table public.chart_of_accounts enable row level security;

-- ============ 20260727184130_branches_denorm_and_index ============
alter table public.invoices add column if not exists branch_name text;
create index if not exists branches_client_idx on public.branches (client_id);
create unique index if not exists branches_client_code_idx on public.branches (client_id, code) where code is not null;
alter table public.branches enable row level security;
create index if not exists invoices_branch_idx on public.invoices (branch_id);

-- ============ 20260731115526_add_extraction_confidence ============
alter table invoices
  add column if not exists extraction_confidence numeric(4,3),
  add column if not exists needs_review boolean not null default false,
  add column if not exists review_notes text[] not null default '{}',
  add column if not exists extraction_audit jsonb not null default '[]';

-- ============ 20260731232725_add_client_default_credit_unmatched ============
alter table clients add column if not exists default_credit_unmatched boolean not null default false;

-- ============ 20260802224041_add_companies_multitenant ============
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
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

insert into companies (name, slug, active, license_expires_at, contact_email)
select 'Precise Tax and Accounting Solutions', 'precisetax', true,
       (current_date + interval '1 year')::date, 'alfredo.silvajr87@gmail.com'
where not exists (select 1 from companies where slug = 'precisetax');

update clients   set company_id = (select id from companies where slug = 'precisetax') where company_id is null;
update app_users set company_id = (select id from companies where slug = 'precisetax') where company_id is null;

-- ============ 20260804121439_add_unit_price_to_invoice_items ============
alter table invoice_items add column if not exists unit_price numeric;

-- ============ 20260804123227_add_license_activation ============
alter table companies add column if not exists pending_license_key text;
alter table companies add column if not exists pending_license_expires_at date;

create table if not exists license_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  event_type text not null,
  old_expires_at date,
  new_expires_at date,
  actor_email text,
  created_at timestamptz not null default now()
);
create index if not exists idx_license_events_company on license_events(company_id, created_at desc);

-- ============ 20260805212816_add_client_related_categories ============
alter table clients add column if not exists related_categories text[] not null default '{}';
