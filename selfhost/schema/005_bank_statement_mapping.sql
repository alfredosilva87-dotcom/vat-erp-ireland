-- =====================================================================
-- Camada A1 — o mapeamento de colunas vira DADO da conta bancária.
--
-- Cada banco exporta o extrato numa forma diferente. Embutir formato de banco
-- no código faria de cada cliente novo um trabalho de programação, e isso não
-- escala num escritório que atende dezenas de empresas.
--
-- Aqui o formato é guardado por conta bancária: o contador confirma o
-- mapeamento uma vez, na tela, e a partir da segunda importação daquele banco
-- não há mais pergunta nenhuma.
--
-- Formato do jsonb (ver ColumnMapping em lib/bankStatement.ts):
--   { headerRow, date, description, reference, payee, amount, debit, credit,
--     balance, amountStyle, dateStyle, invertSign }
-- =====================================================================

alter table bank_accounts
  add column if not exists column_mapping jsonb;
