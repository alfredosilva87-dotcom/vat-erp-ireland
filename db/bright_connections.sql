-- =====================================================================
-- Bright / BrightBooks (Surf Accounts) — armazenamento de credenciais
-- por cliente para a conexão via API.
-- ---------------------------------------------------------------------
-- ⚠️ NÃO APLICAR AINDA. Rodar somente quando a Bright liberar acesso de
--    parceiro à API. Enquanto isso, a integração usa export por CSV e o
--    conector responde "api_not_available" (lib/brightApi.ts).
--
-- Segurança: NÃO guardar senha em texto puro. Preferir referência a um
-- secret (Vault / env) ou criptografar em nível de aplicação. Colunas
-- abaixo já preveem isso (secret_ref).
-- =====================================================================

create table if not exists bright_connections (
    id              uuid primary key default uuid_generate_v4(),
    client_id       uuid not null references clients(id) on delete cascade,
    provider        text not null default 'brightbooks', -- brightbooks/surf
    base_url        text,                 -- ex: https://ap.surfaccounts.com
    username        text,                 -- usuário Surf (se aplicável)
    secret_ref      text,                 -- referência ao secret (NÃO a senha)
    api_key_ref     text,                 -- referência à chave (se a Bright fornecer)
    -- de-para conta local -> nominal ledger code do Surf, quando divergir
    nominal_map     jsonb not null default '{}',
    active          boolean not null default false,
    last_tested_at  timestamptz,
    last_status     text,                 -- resultado do último testConnection
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (client_id, provider)
);

create index if not exists idx_bright_connections_client on bright_connections(client_id);

-- RLS deny-by-default (o servidor usa service role, como o restante do app).
alter table bright_connections enable row level security;
