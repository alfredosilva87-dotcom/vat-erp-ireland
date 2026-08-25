-- Que módulos se integram, por cliente.
--
-- O pedido do Alfredo (2026-08-24), com as palavras dele: um cliente com pouca
-- movimentação, que quer trabalhar de forma mais manual, "deixaria apenas notas
-- fiscais integradas" — para os outros módulos não gerarem poluição de dados.
--
-- Até aqui a integração era implícita e tudo-ou-nada: o título a pagar nascia
-- dentro da CONTABILIZAÇÃO, então quem não usava o módulo contábil não tinha
-- contas a pagar nenhuma, e quem usava passava a ter tudo. Nenhum dos dois é o
-- que um escritório quer decidir por cliente.
--
-- Tudo LIGADO por omissão, e isto é deliberado: mudar o padrão para desligado
-- faria os clientes que já existem perderem comportamento em silêncio na
-- primeira vez que alguém subisse esta migração.
create table if not exists client_integrations (
  client_id uuid primary key references clients(id) on delete cascade,

  -- Nota fiscal de compra vira título a pagar.
  purchases_to_payable boolean not null default true,
  -- Venda vira título a receber.
  sales_to_receivable boolean not null default true,
  -- Documentos geram lançamento no razão (o módulo Contabilidade).
  documents_to_accounting boolean not null default true,
  -- A folha de pagamento vira título a pagar.
  hr_to_payable boolean not null default true,
  -- O movimento do banco dá baixa nos títulos automaticamente.
  bank_settles_titles boolean not null default true,

  updated_by uuid,
  updated_at timestamptz not null default now()
);

comment on table client_integrations is
  'Que modulos se integram entre si, por cliente. Ausencia de linha = tudo ligado (ver lib/integrations.ts).';
