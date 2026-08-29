-- A IDENTIDADE FISCAL do cliente, e o cofre de documentos dele.
--
-- ---------------------------------------------------------------------------
-- POR QUE ISTO É A BASE DE TUDO O QUE VEM A SEGUIR
--
-- O sistema sabe o VAT number, o CRO e a morada, e não sabe a única coisa que
-- decide o resto: se o cliente é um EMPRESÁRIO EM NOME INDIVIDUAL ou uma
-- SOCIEDADE POR QUOTAS.
--
-- Dessa distinção decorre tudo o que o escritório tem de fazer por ele:
--
--   sole trader     → Form 11 (income tax), preliminary tax, sem contas no CRO
--   limited company → CT1 (corporation tax), contas anuais no CRO, B1
--
-- E os dois têm VAT, mas com limiares de registo diferentes conforme vendam
-- bens ou serviços.
--
-- Sem este campo, nenhum alerta consegue saber o que alertar: um calendário
-- que mostra CT1 a um sole trader é pior do que calendário nenhum, porque
-- ensina a ignorá-lo.
-- ---------------------------------------------------------------------------

alter table clients add column if not exists legal_form text;

alter table clients drop constraint if exists clients_legal_form_check;
alter table clients add constraint clients_legal_form_check
  check (legal_form is null or legal_form in ('sole_trader', 'limited_company'));

-- NULO é um estado legítimo, e não um defeito: os clientes que já existem
-- entram sem forma jurídica até alguém a preencher. O que NÃO se faz é adivinhar
-- um valor por omissão — um `sole_trader` presumido faria o sistema deixar de
-- cobrar as contas anuais de uma sociedade, em silêncio.
comment on column clients.legal_form is
  'sole_trader | limited_company. Nulo = por preencher; decide obrigacoes e limiares.';

-- O nome que está no papel timbrado e o nome que está no registo raramente são
-- o mesmo, e a declaração leva o do registo.
alter table clients add column if not exists trading_name text;
alter table clients add column if not exists director text;

create index if not exists idx_clients_legal_form on clients(legal_form);

-- ---------------------------------------------------------------------------
-- O COFRE DE DOCUMENTOS DO CLIENTE
--
-- O sistema guardava documentos FISCAIS — notas e vendas — e não tinha onde pôr
-- os documentos DO CLIENTE: identidade, comprovativo de morada, pacto social.
-- São os que o escritório tem de apresentar quando alguém pergunta, e hoje
-- vivem numa pasta partilhada fora do sistema, que é onde se perdem.
--
-- `expires_on` existe porque documento de identidade CADUCA, e um cliente com
-- identificação expirada é um problema de compliance que não avisa sozinho.
-- ---------------------------------------------------------------------------
create table if not exists client_documents (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients(id) on delete cascade,
  -- identity | address | incorporation | tax | other. Texto e não enum: a lista
  -- do que um escritorio guarda cresce, e cada tipo novo nao deve ser migracao.
  kind              text not null default 'other',
  title             text,
  storage_path      text not null,
  original_filename text,
  mime_type         text,
  size_bytes        integer,
  issued_on         date,
  expires_on        date,
  notes             text,
  uploaded_by       uuid,
  created_at        timestamptz not null default now()
);

create index if not exists idx_client_docs_client on client_documents(client_id, kind);
-- Para a varredura de documentos a caducar, quando ela existir.
create index if not exists idx_client_docs_expiry on client_documents(expires_on)
  where expires_on is not null;

alter table client_documents enable row level security;
