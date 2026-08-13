-- =====================================================================
-- Camada B4 — a PASSAGEM na nuvem. OUTRO banco de dados.
--
-- LEIA ANTES DE APLICAR: isto NÃO vai no banco do escritório. Vai num projeto
-- Supabase separado, que serve a tela de captura e recebe a foto. Está em
-- subpasta justamente para o carregador do instalador não pegar (ele só aplica
-- os .sql da raiz de selfhost/schema).
--
-- Por que existir: o telefone do cliente está na rua, no 4G. O servidor do
-- escritório é da rede local e não deve ser alcançável de fora. Alguém tem que
-- ser alcançável, e é esta passagem.
--
-- O QUE ELA É: um balcão. Guarda a foto até o servidor do escritório buscar, e
-- então o servidor APAGA. Não é armazenamento, é trânsito — e é essa distinção
-- que o compliance do escritório está aprovando.
--
-- O QUE ELA NÃO TEM, de propósito: razão, lançamento, nota fiscal lida, valor,
-- VAT, fornecedor, usuário do escritório, senha. Um despejo completo deste banco
-- rende fotos ainda não buscadas e uma lista de tokens de envio — nada de
-- contabilidade. É esse o teto do dano, e ele foi escolhido.
--
-- Não há chave estrangeira para `clients`: a passagem não tem a tabela de
-- clientes do escritório e não deve ter. O `client_id` aqui é um uuid opaco que
-- só o escritório sabe interpretar.
-- =====================================================================

do $$ begin
  create type relay_direction as enum ('purchase','sale');
exception when duplicate_object then null;
end $$;

-- ---------- Cópia dos links, empurrada pelo escritório ----------
-- Cópia, não original: o dono é `client_phone_links` no banco do escritório.
-- Existe aqui para a passagem poder recusar um envio sem alcançar o escritório —
-- que é o ponto inteiro do desenho.
create table if not exists phone_links (
  token      text primary key,
  client_id  uuid not null,
  -- O que o cliente vê na tela ("Enviando para: Loja da Ponte"). É o nome do
  -- próprio negócio dele, que ele obviamente já sabe — não é informação nova
  -- exposta. Guardar o nome evita a tela dizer só "enviando" e deixar dúvida se
  -- a foto vai para o lugar certo.
  label      text,
  person     text not null,
  allow_sale boolean not null default false,
  active     boolean not null default true,
  expires_at date,
  last_used_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_relay_links_active on phone_links(active);

-- ---------- A foto esperando ser buscada ----------
create table if not exists phone_uploads (
  id          uuid primary key default gen_random_uuid(),
  -- Id gerado NO TELEFONE, antes de enviar. É o que torna a retentativa
  -- inofensiva: o sinal cai no meio do envio, o telefone tenta de novo, e o
  -- mesmo upload_id chega — a passagem reconhece e responde "já recebi" em vez
  -- de guardar a mesma foto duas vezes. Sem isso, uma barra de sinal ruim no
  -- posto vira três lançamentos iguais na fila do analista.
  upload_id   text not null unique,

  token       text not null references phone_links(token) on delete cascade,
  client_id   uuid not null,
  direction   relay_direction not null default 'purchase',
  person      text,
  -- O que o cliente escreveu na tela, se escreveu. Cortado antes de chegar aqui.
  note        text,

  filename    text not null,
  mime_type   text not null,
  size_bytes  int not null,
  -- SHA-256 do conteúdo, calculado no telefone e reconferido aqui. Vai junto
  -- para o escritório poder reconhecer o reenvio da MESMA foto pela trava que a
  -- camada B2 já tem em `inbox_items`, sem precisar ler o arquivo de novo.
  content_hash text,
  -- Caminho no bucket privado desta passagem.
  storage_path text not null,

  sent_at     timestamptz not null default now(),
  -- Marcado pelo escritório quando a busca deu certo. A linha é apagada em
  -- seguida; a marca existe para o caso de a busca cair entre baixar e apagar,
  -- e aí a próxima sabe que essa já foi.
  fetched_at  timestamptz
);

create index if not exists idx_relay_uploads_pending
  on phone_uploads(sent_at) where fetched_at is null;
create index if not exists idx_relay_uploads_token on phone_uploads(token, sent_at desc);

-- ---------- Trancado ----------
-- RLS ligada e NENHUMA política: com isso a chave anônima — a que vai no
-- navegador — não lê nem escreve nada aqui. Tudo passa pela rota do servidor,
-- que usa a chave de serviço e confere o token antes.
--
-- Isto não é zelo excessivo: a tela de captura é PÚBLICA por desenho, então o
-- que quer que ela carregue está nas mãos de qualquer um. Se a chave anônima
-- tivesse leitura em `phone_uploads`, o link de um cliente daria as fotos de
-- todos os outros.
alter table phone_links enable row level security;
alter table phone_uploads enable row level security;

-- ---------- O bucket ----------
-- Privado. O escritório baixa com a chave de serviço; ninguém baixa pelo
-- navegador. Criar por SQL para a instalação não depender de alguém clicar
-- certo no painel do Supabase — e `public => false` é o campo que importa.
insert into storage.buckets (id, name, public)
values ('phone-uploads', 'phone-uploads', false)
on conflict (id) do update set public = false;
