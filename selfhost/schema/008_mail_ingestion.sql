-- =====================================================================
-- Camada B2 — entrada por e-mail.
--
-- O que a camada compra: o endereço pode ser dado **direto ao fornecedor**. O
-- cliente não faz nada — não tira foto, não entra no sistema — e a fatura chega
-- sozinha na fila do escritório.
--
-- **A caixa é buscada, não recebida.** O servidor roda na rede do escritório sem
-- exposição à internet, então receber SMTP exigiria abrir porta e publicar MX
-- apontando para dentro. O servidor busca por IMAP numa caixa do próprio
-- escritório, e a premissa de que dado nenhum sai continua valendo.
--
-- **A senha do IMAP não mora aqui.** Vem de variável de ambiente, como a chave
-- do Gemini. Um despejo do banco não pode carregar a senha da caixa de e-mail do
-- escritório junto com as notas.
--
-- **A fila não existia.** Até aqui, a "fila de extração" era a lista dentro do
-- navegador na tela de leitura: o arquivo nunca chegava ao servidor sem alguém
-- para arrastá-lo. E-mail chega sem navegador nenhum, então a fila precisa ser
-- do servidor — é o que `inbox_items` é.
-- =====================================================================

do $$ begin
  create type mail_direction as enum ('purchase','sale');
exception when duplicate_object then null;
end $$;

-- ---------- O endereço de cada cliente ----------
-- Sub-endereçamento: uma caixa só (`notas@escritorio.ie`) e o pedaço depois do
-- `+` diz de quem é a nota. O token é OPACO de propósito: o endereço vai ser
-- dado a fornecedor, e `notas+c0001@` contaria quantos clientes o escritório tem
-- e deixaria adivinhar o endereço do vizinho.
create table if not exists client_mail_routes (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  direction  mail_direction not null,
  token      text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Token repetido rotearia a nota de um cliente para outro, então a unicidade é
-- global e do banco — não "o código gera aleatório, deve dar certo".
create unique index if not exists idx_client_mail_routes_token
  on client_mail_routes(token);
-- Um endereço por cliente e direção: dois endereços de compra para a mesma
-- empresa só criam dúvida sobre qual está impresso no pedido do fornecedor.
create unique index if not exists idx_client_mail_routes_client
  on client_mail_routes(client_id, direction);

-- ---------- Quem pode mandar ----------
-- `pattern` é um endereço inteiro (`ap@fornecedor.ie`) ou um domínio
-- (`@fornecedor.ie`). Nunca expressão regular: um caractere errado
-- transformaria "só este remetente" em "qualquer um" sem avisar.
create table if not exists mail_senders (
  id         uuid primary key default gen_random_uuid(),
  -- Nulo = vale para todos os clientes do escritório.
  client_id  uuid references clients(id) on delete cascade,
  pattern    text not null,
  mode       text not null check (mode in ('allow','block')),
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_mail_senders_client on mail_senders(client_id);

-- ---------- O registro de cada busca ----------
-- Mesmo papel de `bank_imports` na camada A1: sem isto, "não chegou nada" e "a
-- busca nunca rodou" viram a mesma tela vazia.
create table if not exists mail_fetches (
  id           uuid primary key default gen_random_uuid(),
  mailbox      text,
  seen_count   int not null default 0,
  accepted_count int not null default 0,
  refused_count  int not null default 0,
  duplicate_count int not null default 0,
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index if not exists idx_mail_fetches_started on mail_fetches(started_at desc);

-- ---------- A fila ----------
create table if not exists inbox_items (
  id          uuid primary key default gen_random_uuid(),
  -- Nulo quando a mensagem não pôde ser roteada. O item existe assim mesmo, com
  -- o motivo escrito: e-mail que some em silêncio é o defeito que faz o
  -- escritório deixar de confiar na entrada automática.
  client_id   uuid references clients(id) on delete cascade,
  direction   mail_direction,
  fetch_id    uuid references mail_fetches(id) on delete set null,

  source      text not null default 'email',
  sender      text,
  subject     text,
  -- O corpo do e-mail, que é onde o fornecedor escreve o que a nota não diz.
  body        text,
  received_at timestamptz,
  message_id  text,

  filename    text,
  mime_type   text,
  size_bytes  int,
  -- Caminho no bucket `documents`, como `invoices.document_path`.
  document_path text,
  -- SHA-256 do conteúdo do anexo. É o que reconhece o reenvio do MESMO arquivo,
  -- exato e sem custo de IA — antes de qualquer leitura.
  content_hash text,

  -- pending: esperando leitura | read: lido, esperando conferência
  -- saved: virou nota | duplicate: já existe | refused: não entrou
  -- discarded: o escritório descartou
  status      text not null default 'pending'
              check (status in ('pending','read','saved','duplicate','refused','discarded')),
  refused_reason text,
  -- Preenchida quando o item virou nota. Uma anexo pode virar várias notas
  -- (PDF com 5 faturas dentro), e aí guarda quantas.
  invoice_id  uuid references invoices(id) on delete set null,
  invoice_count int not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- O MESMO arquivo, do MESMO cliente e para a MESMA direção, não entra duas vezes.
-- Como na camada A1, a trava é do banco e não do código: duas buscas simultâneas
-- (o botão clicado duas vezes, ou o cron encavalando) filtrariam em JavaScript e
-- as duas passariam. O código conta o que entrou; o índice é que garante.
--
-- A direção entra na chave porque sem ela o conserto do erro mais comum era
-- recusado: quem manda a nota para o endereço errado e reenvia para o certo
-- tinha a segunda — a CERTA — engolida como duplicata da primeira. Encontrado
-- testando com servidor de e-mail de verdade.
create unique index if not exists idx_inbox_items_hash
  on inbox_items(client_id, direction, content_hash)
  where content_hash is not null and client_id is not null and direction is not null;

create index if not exists idx_inbox_items_status on inbox_items(status, created_at desc);
create index if not exists idx_inbox_items_client on inbox_items(client_id, status);

alter table client_mail_routes enable row level security;
alter table mail_senders       enable row level security;
alter table mail_fetches       enable row level security;
alter table inbox_items        enable row level security;
