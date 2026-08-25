-- O encargo do título passa a poder ter lançamento próprio.
--
-- `journal.source_module` não conhecia 'charge'. Sem ele, o juro acrescentado a
-- uma conta a pagar aumentava o valor em aberto na tela e NÃO produzia partida
-- nenhuma no razão — o balancete ficava a dever exatamente o que o título dizia
-- a mais, e a diferença só apareceria na conciliação, semanas depois.
--
-- 'charge' e não 'manual': a origem é o que permite, mais tarde, perguntar
-- "quanto pagámos de juro este ano" sem adivinhar pela descrição.
alter table journal drop constraint if exists journal_source_module_check;
alter table journal add constraint journal_source_module_check
  check (source_module = any (array['purchase', 'sale', 'bank', 'payroll', 'charge', 'manual', 'opening']));
