-- =====================================================================
-- Camada B4 — entrada por telefone. Parte do ESCRITÓRIO.
--
-- O que a camada compra: o cliente do escritório fotografa a nota onde ela é
-- entregue — no posto de combustível, no balcão do fornecedor — e ela chega na
-- fila do analista sem ninguém digitar nada.
--
-- **Quem envia não é usuário do sistema.** É cliente do escritório, e não tem
-- senha. Senha protege leitura, e o link dele não lê nada: só escreve. O pior
-- caso de um link vazado é foto de lixo na fila, que o analista descarta — não
-- vazamento da contabilidade. Cobrar senha de um dono de loja no posto custaria
-- a praticidade inteira, que é o motivo desta camada existir.
--
-- **O link é por PESSOA, não por cliente.** O motorista e o dono da loja mandam
-- pelo mesmo cliente; quando um telefone se perde, revoga-se só aquele link.
--
-- **A captura não é servida por aqui.** O telefone está na rua, no 4G, e este
-- servidor é da rede do escritório — ele não alcança e nem deve ser alcançável.
-- A tela de captura e o recebimento ficam numa passagem na nuvem, e este
-- servidor **busca e apaga** de lá. O esquema dessa passagem está em
-- `selfhost/schema/relay/`, que é OUTRO banco de dados de propósito, e por isso
-- fica em subpasta: o carregador só aplica os .sql da raiz.
--
-- Esta tabela é a DONA do link. A nuvem tem uma cópia, para poder validar o
-- envio sem alcançar o escritório, e a cópia é empurrada daqui para lá.
-- =====================================================================

-- ---------- O link de cada remetente ----------
create table if not exists client_phone_links (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,

  -- 12 caracteres opacos. Opaco pelo mesmo motivo da B2: o link vai por
  -- WhatsApp, e `/enviar/cliente-7` contaria a quem recebe quantos clientes o
  -- escritório tem e deixaria adivinhar o link do vizinho.
  token      text not null unique,

  -- Quem é a pessoa. Não é login — é o que o analista lê na fila para saber de
  -- quem veio a foto, porque na fila um recibo de posto é igual ao seguinte.
  person     text not null,

  -- A direção que este link pode mandar. Padrão é só custo: quem fotografa no
  -- posto está registrando despesa, e pedir para ele classificar é devolver ao
  -- cliente o trabalho do analista.
  allow_sale boolean not null default false,

  active     boolean not null default true,
  -- Prazo opcional. Existe porque revogar de verdade depende de alguém lembrar,
  -- e link no telefone de ex-funcionário é o que mais fica esquecido.
  expires_at date,

  -- Último envio que passou por este link. É o que faz o escritório notar link
  -- morto (nunca usado) e link abusado (usado quando não devia).
  last_used_at timestamptz,
  -- Quando a cópia na nuvem foi confirmada. Nulo = a nuvem ainda não sabe deste
  -- link, então ele ainda não funciona; a tela mostra isso em vez de deixar o
  -- escritório mandar por WhatsApp um link que não abre.
  synced_at  timestamptz,

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_phone_links_client on client_phone_links(client_id, active);
create index if not exists idx_phone_links_company on client_phone_links(company_id);

-- Duas pessoas do mesmo cliente não podem ter o mesmo nome de remetente: a fila
-- mostra o nome, e dois "Joao" no mesmo cliente fazem a trilha não dizer nada.
create unique index if not exists idx_phone_links_person
  on client_phone_links(client_id, lower(person))
  where active;

alter table client_phone_links enable row level security;

-- ---------- O que a busca já trouxe ----------
-- A passagem na nuvem é apagada depois de cada busca, então ela não serve de
-- histórico. Esta tabela é o registro de que a busca aconteceu, para o
-- escritório poder responder "a foto que mandei chegou?" sem depender da nuvem.
create table if not exists phone_fetches (
  id         uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Quantos envios a nuvem tinha, quantos entraram, quantos já existiam e
  -- quantos falharam. Separados porque "0 novos" e "3 falharam" são situações
  -- diferentes e a segunda precisa aparecer.
  found      int not null default 0,
  ingested   int not null default 0,
  duplicates int not null default 0,
  failed     int not null default 0,
  error      text
);

create index if not exists idx_phone_fetches_started on phone_fetches(started_at desc);

alter table phone_fetches enable row level security;

-- ---------- A fila já existe ----------
-- `inbox_items.source` já é texto com padrão 'email', então foto de telefone
-- entra como 'phone' sem coluna nova, cai na MESMA fila que o analista revisa e
-- na MESMA trava de duplicata por (cliente, direção, hash) da camada B2.
-- O `sender` guarda a pessoa, e o `message_id` guarda `relay:<id do envio>`,
-- que é o que impede a mesma foto de entrar duas vezes se a busca repetir.
