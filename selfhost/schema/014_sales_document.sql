-- Venda com DOCUMENTO e ITENS, como a nota de entrada já tinha.
--
-- Até aqui `sales` era só uma linha de resumo (data, número, cliente, líquido,
-- IVA). Serviu enquanto venda entrava digitada ou por planilha, onde o próprio
-- arquivo importado era a prova. Deixou de servir quando a venda passou a
-- entrar por FOTO (camada B4): a imagem que o cliente mandou não ficava
-- guardada em lugar nenhum, e uma venda sem o documento que a sustenta não se
-- defende numa auditoria — o mesmo motivo pelo qual a nota de entrada guarda o
-- arquivo desde o começo.
alter table sales add column if not exists document_path     text;
alter table sales add column if not exists original_filename text;
-- Por onde entrou: "upload" | "email" | "phone" | "manual" (digitada/planilha).
-- Mesmo vocabulário de `invoices.source` — ver lib/origin.ts.
alter table sales add column if not exists source            text;
-- A leitura por IA erra, e numa venda o erro sobe o IVA a pagar. O mesmo
-- semáforo da entrada, pelo mesmo motivo: leitura fraca não entra calada.
alter table sales add column if not exists needs_review      boolean not null default false;
alter table sales add column if not exists extraction_confidence numeric(4,3);
create index if not exists idx_sales_source on sales(source);

/*
 * As linhas da venda.
 *
 * Tabela própria, e não uma coluna JSON, para a venda por alíquota poder ser
 * somada pelo banco — é o que o VAT3 pede (T1 por taxa), e é a mesma forma que
 * `invoice_items` tem do lado da compra.
 *
 * Documento sem itens legíveis (planilha fotografada, recibo só com o total)
 * grava UMA linha genérica com o valor e a alíquota. Não é enfeite: sem uma
 * linha, a venda não aparece na apuração por taxa e o total por alíquota
 * fecharia menor que o total do período, sem ninguém achar a diferença.
 */
create table if not exists sales_items (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references sales(id) on delete cascade,
  description  text not null,
  quantity     numeric(14,3),
  unit_price   numeric(14,2),
  net_amount   numeric(14,2),
  vat_rate     numeric(4,1),
  vat_amount   numeric(14,2) not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_sales_items_sale on sales_items(sale_id);
alter table sales_items enable row level security;
