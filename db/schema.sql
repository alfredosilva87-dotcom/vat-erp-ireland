-- =====================================================================
-- Leitor de Notas Fiscais (Irlanda) — Modelo de dados
-- Postgres / Supabase
-- =====================================================================
-- Convenções:
--   • Todos os valores monetários em EUR (numeric(14,2)).
--   • Alíquotas em pontos percentuais: 23, 13.5, 9, 4.8, 0.
--   • A base de alíquotas (vat_categories) é mantida MANUALMENTE pelo
--     contador/analista — este schema só guarda; a atualização é humana.
-- =====================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- 1. EMPRESAS  (a empresa dona das notas — define o "objeto social")
-- ---------------------------------------------------------------------
create table if not exists companies (
    id              uuid primary key default uuid_generate_v4(),
    name            text not null,
    vat_number      text,                       -- IE VAT number
    -- objeto social: usado para pré-sugerir se um item gera crédito
    activity_code   text,                       -- código interno de atividade (ex: 'RESTAURANT')
    activity_label  text,                       -- descrição legível (ex: 'Restaurante / catering')
    nace_code       text,                       -- NACE opcional
    notes           text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. BASE DE ALÍQUOTAS  (espelha o VAT rates database do Revenue)
--    Carga e manutenção manual pelo contador.
-- ---------------------------------------------------------------------
create type vat_rate_type as enum (
    'standard',        -- 23%
    'reduced',         -- 13.5%
    'second_reduced',  -- 9%
    'livestock',       -- 4.8%
    'zero',            -- 0%
    'exempt'           -- isento (sem VAT, sem crédito)
);

create table if not exists vat_categories (
    id              uuid primary key default uuid_generate_v4(),
    code            text unique,                -- código interno opcional
    description     text not null,              -- ex: 'Restaurant / catering services'
    -- palavras-chave para o "de-para" descrição do item -> categoria
    keywords        text[] not null default '{}',
    vat_rate        numeric(4,1) not null,      -- 23.0 / 13.5 / 9.0 / 4.8 / 0.0
    rate_type       vat_rate_type not null,
    revenue_ref     text,                       -- link/nota da fonte no Revenue
    effective_from  date not null default '2000-01-01',
    effective_to    date,                       -- null = vigente
    active          boolean not null default true,
    updated_by      text,                       -- quem atualizou (contador)
    updated_at      timestamptz not null default now()
);

create index if not exists idx_vat_categories_active on vat_categories(active);
create index if not exists idx_vat_categories_keywords on vat_categories using gin(keywords);

-- ---------------------------------------------------------------------
-- 3. REGRAS DE CRÉDITO  (por objeto social)
--    Pré-sugere "tomar crédito ou não" conforme a atividade da empresa.
--    Ex: empresa RESTAURANT + item categoria 'peixe/marisco' => dedutível
--        (camarão é insumo da cozinha).
-- ---------------------------------------------------------------------
create table if not exists credit_rules (
    id                  uuid primary key default uuid_generate_v4(),
    activity_code       text not null,          -- casa com companies.activity_code ('*' = qualquer)
    -- alvo da regra: por categoria OU por palavra-chave da descrição
    vat_category_id     uuid references vat_categories(id) on delete cascade,
    match_keywords      text[] not null default '{}',
    deductible_default  boolean not null,       -- crédito pré-sugerido (true/false)
    rationale           text,                   -- justificativa legível
    -- itens tipicamente NÃO dedutíveis na Irlanda (entretenimento, combustível
    -- de carro de passeio, refeições/hospedagem, etc.) => deductible_default=false
    priority            int not null default 100, -- menor = avaliada primeiro
    active              boolean not null default true,
    updated_by          text,
    updated_at          timestamptz not null default now()
);

create index if not exists idx_credit_rules_activity on credit_rules(activity_code, active);

-- ---------------------------------------------------------------------
-- 4. NOTAS / RECIBOS
-- ---------------------------------------------------------------------
create type doc_type as enum ('invoice', 'receipt', 'other');
create type invoice_status as enum ('pending_review', 'reviewed', 'error');

create table if not exists invoices (
    id                  uuid primary key default uuid_generate_v4(),
    company_id          uuid references companies(id) on delete set null,
    source_filename     text,
    doc_type            doc_type not null default 'invoice',
    supplier_name       text,
    supplier_vat        text,
    invoice_number      text,
    invoice_date        date,
    currency            text not null default 'EUR',
    total_net           numeric(14,2),
    total_vat           numeric(14,2),
    total_gross         numeric(14,2),
    -- rastreio da leitura
    extraction_engine   text,                   -- 'pdf-native' | 'gemini' | 'tesseract'
    extraction_confidence numeric(4,3),         -- 0..1
    raw_extraction      jsonb,                  -- payload bruto do motor de leitura
    status              invoice_status not null default 'pending_review',
    created_at          timestamptz not null default now()
);

create index if not exists idx_invoices_company on invoices(company_id);

-- ---------------------------------------------------------------------
-- 5. ITENS DA NOTA
-- ---------------------------------------------------------------------
create type inconsistency_flag as enum (
    'ok',            -- alíquota da nota bate com a esperada
    'rate_mismatch', -- alíquota da nota difere da base
    'no_vat_on_doc', -- documento não traz VAT do item (ex: recibo Tesco)
    'unmatched'      -- não foi possível casar a descrição com a base
);

create table if not exists invoice_items (
    id                    uuid primary key default uuid_generate_v4(),
    invoice_id            uuid not null references invoices(id) on delete cascade,
    line_no               int,
    description           text not null,        -- descrição como está na nota
    description_normalized text,                -- normalizada para matching
    quantity              numeric(14,3),
    unit_price            numeric(14,4),
    net_amount            numeric(14,2),
    -- o que veio NA NOTA (pode ser nulo em recibo sem VAT por item)
    vat_rate_on_invoice   numeric(4,1),
    vat_amount_on_invoice numeric(14,2),
    -- o que a BASE diz que deveria ser
    matched_vat_category_id uuid references vat_categories(id) on delete set null,
    expected_vat_rate     numeric(4,1),
    match_confidence      numeric(4,3),         -- 0..1 (confiança do de-para)
    inconsistency         inconsistency_flag not null default 'unmatched',
    -- crédito
    credit_suggested      boolean,              -- o que a regra sugeriu
    credit_rationale      text,
    take_credit           boolean,              -- decisão final do usuário (editável)
    reviewed              boolean not null default false
);

create index if not exists idx_items_invoice on invoice_items(invoice_id);
create index if not exists idx_items_flag on invoice_items(inconsistency);

-- ---------------------------------------------------------------------
-- trigger simples de updated_at
-- ---------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_companies_touch on companies;
create trigger trg_companies_touch before update on companies
    for each row execute function touch_updated_at();

drop trigger if exists trg_vatcat_touch on vat_categories;
create trigger trg_vatcat_touch before update on vat_categories
    for each row execute function touch_updated_at();

drop trigger if exists trg_creditrules_touch on credit_rules;
create trigger trg_creditrules_touch before update on credit_rules
    for each row execute function touch_updated_at();
