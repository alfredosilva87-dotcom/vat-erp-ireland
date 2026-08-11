-- =====================================================================
-- Camada B3 — melhorias de revisão.
--
-- Três coisas que o sistema não sabia responder:
--
--   1. "Quem mudou isso, e quando?" — a nota era editável e nada guardava a
--      alteração. Numa auditoria, "o valor está diferente do PDF" sem histórico
--      é indefensável: não há como mostrar que foi uma correção consciente e não
--      um erro de digitação que ninguém viu.
--   2. "A mesma nota chegou duas vezes, com fotos diferentes." Até aqui a
--      segunda era descartada, e com ela a foto que às vezes está mais legível
--      que a primeira. Agora as duas ficam no MESMO lançamento.
--   3. "Conferi estas vinte, todas certas." Não havia como dizer isso — o
--      `needs_review` só saía nota por nota, na tela de edição.
-- =====================================================================

-- ---------- Vários documentos por nota ----------
-- `invoices.document_path` continua sendo o documento principal: toda tela,
-- todo export e a rota de download apontam para ele, e trocar isso agora seria
-- risco sem ganho. Esta tabela guarda os documentos ADICIONAIS — a segunda foto
-- do mesmo recibo, o anexo que veio depois.
create table if not exists invoice_documents (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references invoices(id) on delete cascade,
  document_path text not null,
  filename      text,
  mime_type     text,
  size_bytes    int,
  -- De onde veio: 'merged' = juntada a partir de uma duplicata detectada.
  source        text not null default 'merged',
  note          text,
  -- uuid solto, pela mesma razão de `invoice_audit.actor_id`: juntar um documento
  -- não pode falhar porque quem juntou saiu do escritório.
  added_by      uuid,
  added_by_email text,
  added_at      timestamptz not null default now()
);
create index if not exists idx_invoice_documents_invoice
  on invoice_documents(invoice_id, added_at);

-- O mesmo arquivo não é anexado duas vezes à mesma nota: quem clica "juntar"
-- duas vezes (a tela demorou, o clique repetiu) não pode acabar com duas cópias
-- da mesma imagem pendurada no lançamento.
create unique index if not exists idx_invoice_documents_path
  on invoice_documents(invoice_id, document_path);

-- ---------- A trilha ----------
-- Uma linha por alteração, não uma foto do estado. O que a auditoria pergunta é
-- "o que mudou", e isso só existe guardando o valor antigo ao lado do novo.
--
-- `actor_email` é COPIADO, não só referenciado: se o usuário for apagado do
-- sistema no ano seguinte, a trilha tem de continuar dizendo quem foi.
--
-- E `actor_id` é uuid SOLTO, sem chave estrangeira para `app_users`, de
-- propósito. Com a chave, o banco **recusava a linha da trilha** quando o autor
-- não existia mais — e como gravar trilha não pode derrubar a alteração, o erro
-- era engolido e o histórico aparecia vazio, indistinguível de nota nunca
-- alterada. Uma trilha de auditoria não pode depender de outra tabela continuar
-- tendo suas linhas. Encontrado testando.
create table if not exists invoice_audit (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices(id) on delete cascade,
  actor_id    uuid,
  actor_email text,
  -- created | edited | item_edited | item_added | approved | reopened |
  -- documents_merged
  action      text not null,
  -- Qual campo mudou, quando a ação é uma edição.
  field       text,
  old_value   text,
  new_value   text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_invoice_audit_invoice
  on invoice_audit(invoice_id, created_at desc);

-- ---------- Aprovação ----------
-- `needs_review` já dizia se a leitura pediu conferência. O que faltava era
-- registrar que alguém CONFERIU: sem data e sem nome, "revisada" é indistinguível
-- de "a leitura veio confiante e ninguém olhou".
alter table invoices add column if not exists reviewed_at  timestamptz;
-- Sem chave estrangeira, pela mesma razão da trilha: aprovar uma nota não pode
-- falhar porque o usuário que aprovou foi desativado e apagado depois.
alter table invoices add column if not exists reviewed_by  uuid;
alter table invoices add column if not exists reviewed_by_email text;

create index if not exists idx_invoices_review
  on invoices(client_id, needs_review) where needs_review = true;

alter table invoice_documents enable row level security;
alter table invoice_audit     enable row level security;

-- Instalação que recebeu a primeira versão deste arquivo ganhou as chaves
-- estrangeiras de autor. Elas saem: eram justamente o que recusava a linha da
-- trilha quando o autor não existia mais.
alter table invoice_audit      drop constraint if exists invoice_audit_actor_id_fkey;
alter table invoice_documents  drop constraint if exists invoice_documents_added_by_fkey;
alter table invoices           drop constraint if exists invoices_reviewed_by_fkey;
alter table invoice_documents  add column if not exists added_by_email text;
