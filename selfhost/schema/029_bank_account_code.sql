-- A conta contábil de cada conta bancária.
--
-- Até aqui toda baixa creditava 1100 "Bank", qualquer que fosse o banco: um
-- cliente com conta no AIB e no Revolut via os dois movimentos caírem na mesma
-- conta do razão, e o balancete não distinguia de onde o dinheiro saiu. Com a
-- escolha do banco na hora da baixa (que é o que o Alfredo pediu), isso deixa
-- de ser aceitável — escolher a conta e o razão ignorar a escolha é pior do
-- que não deixar escolher.
--
-- Nulo = 1100, o padrão de sempre. Nenhuma instalação precisa de fazer nada.
alter table bank_accounts
  add column if not exists account_code text;

comment on column bank_accounts.account_code is
  'Conta do razao desta conta bancaria. Nulo cai em 1100 (CONTAS_PADRAO.bank).';
