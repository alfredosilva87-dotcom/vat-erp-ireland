-- Quem conferiu a venda, e quando.
--
-- A nota de entrada guarda isso desde a camada B3 (`invoices.reviewed_at`),
-- e a razão vale igual do lado da saída: numa auditoria, "o sistema leu" e
-- "uma pessoa conferiu" são afirmações diferentes, e só a segunda sustenta o
-- número entregue no VAT3.
--
-- Até aqui a venda só tinha `needs_review`, que a tela apagava em silêncio ao
-- salvar — o registro de que alguém olhou não sobrava em lugar nenhum.
alter table sales add column if not exists reviewed_at       timestamptz;
alter table sales add column if not exists reviewed_by       uuid;
alter table sales add column if not exists reviewed_by_email text;
