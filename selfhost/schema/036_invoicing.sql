-- O EMISSOR DE INVOICES: os clientes do nosso cliente, e as faturas que ele emite.
--
-- ---------------------------------------------------------------------------
-- POR QUE ISTO ENTRA NO SISTEMA E NÃO É UM GERADOR DE PDF À PARTE
--
-- Um sole trader emite as suas próprias invoices, ou pede ao escritório que as
-- emita por ele. Hoje isso acontece fora daqui — num Word, num Excel, num site
-- qualquer — e o escritório recebe DEPOIS um PDF que tem de digitar como venda.
--
-- Duas consequências, ambas caras:
--
--   1. A venda entra no sistema por transcrição, com o erro que a transcrição
--      traz, e às vezes não entra de todo;
--   2. o número da invoice é escolhido no Word. Sequências repetidas e saltos
--      são achado clássico de auditoria de VAT, e ninguém os vê até lá.
--
-- Emitir AQUI resolve as duas: a invoice **é** a venda. Nasce numerada em
-- sequência, cai no VAT3, abre título em contas a receber e vai ao razão pelos
-- caminhos que já existem — sem nenhuma integração nova.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- OS CLIENTES DO NOSSO CLIENTE
--
-- `sales.customer` é texto livre, e chega para registar uma venda lida de um
-- documento. Não chega para EMITIR: uma invoice precisa da morada, do número
-- de VAT e do e-mail de quem a recebe, e escrever isso outra vez a cada fatura
-- é onde nascem as moradas desatualizadas e os VAT numbers com um dígito trocado.
-- ---------------------------------------------------------------------------
create table if not exists customers (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  name         text not null,
  vat_number   text,
  email        text,
  phone        text,
  -- Morada em linhas livres, e não em campos separados: uma morada irlandesa,
  -- uma inglesa e uma portuguesa não têm a mesma forma, e obrigar todas ao
  -- molde irlandês faz com que se escreva a cidade no campo do condado.
  address      text,
  country      text default 'Ireland',
  -- Morada de entrega, quando difere da de faturação (o "SHIP TO" da invoice).
  ship_address text,
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_customers_client on customers(client_id, active);
-- Para a busca por nome na tela de emissão.
create index if not exists idx_customers_name on customers(client_id, lower(name));

-- ---------------------------------------------------------------------------
-- A NUMERAÇÃO
--
-- Fica numa tabela própria, e não num `max(number)+1` calculado na hora.
--
-- `max+1` parece equivalente e não é: duas invoices emitidas ao mesmo tempo
-- leem o mesmo máximo e recebem o mesmo número. Numa fatura isso não é um
-- detalhe técnico — dois documentos fiscais com o mesmo número é matéria de
-- auditoria, e só se descobre quando alguém compara.
--
-- A linha é bloqueada e incrementada na mesma transação, então duas emissões
-- simultâneas esperam uma pela outra.
-- ---------------------------------------------------------------------------
create table if not exists invoice_sequences (
  client_id   uuid not null references clients(id) on delete cascade,
  -- O ano deixa a sequência recomeçar: INV-2026-0001. Quem prefere sequência
  -- contínua usa sempre o mesmo ano (0), e a coluna não estorva.
  year        integer not null,
  prefix      text not null default 'INV',
  next_number integer not null default 1,
  primary key (client_id, year)
);

-- ---------------------------------------------------------------------------
-- A INVOICE EMITIDA
--
-- `sale_id` é o elo com o resto do sistema: ao emitir, nasce a linha em `sales`
-- e o VAT, o contas a receber e o razão seguem os caminhos de sempre.
-- ---------------------------------------------------------------------------
create table if not exists issued_invoices (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  customer_id   uuid references customers(id) on delete restrict,
  -- O nome fica GRAVADO na invoice, e não só apontado.
  -- Uma fatura é um documento histórico: se o cliente mudar de morada em
  -- março, a de janeiro tem de continuar a mostrar a morada de janeiro. Um
  -- PDF regerado com dados de hoje deixaria de bater com o que foi enviado.
  customer_name text not null,
  customer_vat  text,
  customer_addr text,
  customer_ship text,
  customer_email text,

  number        text not null,
  issue_date    date not null,
  due_date      date,
  -- "30 dias", "a pronto" — texto livre porque cada negócio tem o seu.
  payment_terms text,
  -- A referência que o comprador pediu que fosse na fatura (o PO dele).
  customer_ref  text,
  currency      text not null default 'EUR',
  notes         text,

  -- Totais GRAVADOS, e não somados das linhas na leitura.
  -- Mesmo motivo do nome: o documento enviado ao cliente tem um total, e esse
  -- total não pode mudar porque alguém corrigiu o arredondamento do sistema
  -- seis meses depois.
  net_amount    numeric(14,2) not null default 0,
  vat_amount    numeric(14,2) not null default 0,
  gross_amount  numeric(14,2) not null default 0,

  -- draft: ainda se edita e ainda não tem número definitivo nem venda.
  -- issued: numerada, virou venda, e já não se edita.
  -- sent: enviada ao destinatário.
  -- cancelled: anulada — NUNCA apagada, ver abaixo.
  status        text not null default 'draft',
  sale_id       uuid references sales(id) on delete set null,
  issued_at     timestamptz,
  sent_at       timestamptz,
  sent_to       text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table issued_invoices drop constraint if exists issued_invoices_status_check;
alter table issued_invoices add constraint issued_invoices_status_check
  check (status in ('draft', 'issued', 'sent', 'cancelled'));

-- Um número emitido é único DENTRO do cliente. O rascunho fica de fora do
-- índice: enquanto não é emitido não tem número a sério para defender.
create unique index if not exists uq_issued_invoice_number
  on issued_invoices(client_id, number) where status <> 'draft';

create index if not exists idx_issued_invoices_client on issued_invoices(client_id, issue_date desc);
create index if not exists idx_issued_invoices_customer on issued_invoices(customer_id);

create table if not exists issued_invoice_items (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references issued_invoices(id) on delete cascade,
  position     integer not null default 0,
  description  text not null,
  -- A segunda linha, mais miúda, por baixo da descrição.
  detail       text,
  quantity     numeric(14,3) not null default 1,
  unit_price   numeric(14,2) not null default 0,
  vat_rate     numeric(4,1) not null default 0,
  net_amount   numeric(14,2) not null default 0,
  vat_amount   numeric(14,2) not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_issued_items_invoice on issued_invoice_items(invoice_id, position);

-- ---------------------------------------------------------------------------
-- O LOGÓTIPO E O RODAPÉ LEGAL DA INVOICE
--
-- O logótipo não vai para `client_documents`: aquele cofre guarda documentos de
-- COMPLIANCE, que caducam e se apresentam a terceiros. Um logótipo é aparência,
-- é um só, e substitui-se — misturá-lo lá dentro faria o cofre passar a ter uma
-- linha que nunca é para mostrar a ninguém.
alter table clients add column if not exists logo_path text;

-- O rodapé obrigatório de uma sociedade irlandesa: número no CRO e diretores.
-- Fica editável porque a redação varia, e porque uma sociedade que muda de
-- direção não deve ter de esperar por uma migração.
alter table clients add column if not exists invoice_footer text;
-- A conta para onde o dinheiro deve ir, escolhida entre as do cliente.
alter table clients add column if not exists invoice_bank_account_id uuid
  references bank_accounts(id) on delete set null;

alter table customers            enable row level security;
alter table invoice_sequences    enable row level security;
alter table issued_invoices      enable row level security;
alter table issued_invoice_items enable row level security;

-- ---------------------------------------------------------------------------
-- O PRÓXIMO NÚMERO, entregue uma vez só.
--
-- Existe como função no banco, e não em JavaScript, porque é o único sítio onde
-- a leitura e a escrita acontecem sem nada no meio. Ler o máximo na aplicação e
-- somar um deixa uma janela entre as duas: duas emissões ao mesmo tempo leem o
-- mesmo valor e recebem o mesmo número.
--
-- O `on conflict do update` tranca a linha, então a segunda emissão espera pela
-- primeira em vez de a acompanhar.
-- ---------------------------------------------------------------------------
create or replace function proximo_numero_invoice(
  p_client_id uuid,
  p_year integer,
  p_prefix text default 'INV'
) returns text
language plpgsql
as $$
declare
  n integer;
  pfx text;
begin
  insert into invoice_sequences (client_id, year, prefix, next_number)
  values (p_client_id, p_year, p_prefix, 2)
  on conflict (client_id, year) do update
    set next_number = invoice_sequences.next_number + 1
  returning next_number - 1, prefix into n, pfx;

  -- Ano 0 é a escolha de quem quer sequência contínua: INV-0001, sem ano.
  if p_year = 0 then
    return pfx || '-' || lpad(n::text, 4, '0');
  end if;
  return pfx || '-' || p_year::text || '-' || lpad(n::text, 4, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- O LINK PARTILHÁVEL da fatura.
--
-- Existe porque o WhatsApp NÃO aceita anexo por link: o único envio possível
-- sem a API de negócio é uma mensagem de texto, e o PDF tem de estar do outro
-- lado de um endereço. Serve também o e-mail de quem prefere link a anexo —
-- muitos servidores rejeitam PDFs de remetentes desconhecidos.
--
-- O token só nasce quando alguém escolhe partilhar, e pode ser revogado. Uma
-- fatura leva o nome, a morada e o número de VAT do comprador: quem tem o
-- endereço vê isso, e por isso o endereço é opt-in e não permanente.
-- ---------------------------------------------------------------------------
alter table issued_invoices add column if not exists share_token text;
alter table issued_invoices add column if not exists share_created_at timestamptz;

create unique index if not exists uq_issued_invoice_share
  on issued_invoices(share_token) where share_token is not null;
