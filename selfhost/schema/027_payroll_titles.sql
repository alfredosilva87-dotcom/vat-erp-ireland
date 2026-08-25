-- A folha de pagamento passa a poder abrir título.
--
-- `ledger_items.source_module` só admitia compra, venda e manual. A folha não
-- é nenhum dos três: não vem de documento fiscal e não é lançamento à mão — é
-- o resultado do quadro semanal do RH.
--
-- Sem 'payroll' na lista, o pagamento da folha aparecia na conciliação
-- bancária como uma transferência grande, todo mês, sem nada contra o que
-- casar — e ficava para trás a engordar a lista do que não bate.
alter table ledger_items drop constraint if exists ledger_items_source_module_check;
alter table ledger_items add constraint ledger_items_source_module_check
  check (source_module = any (array['purchase', 'sale', 'manual', 'payroll']));

-- A conta de contrapartida da folha. Já existe no plano (2400 Payroll
-- liabilities); esta linha só garante que existe numa base criada antes dela.
insert into chart_of_accounts (code, description, type, report_group, postable, client_id, active)
values ('2400', 'Payroll liabilities', 'liability', 'creditors_within_1y', true, null, true)
on conflict do nothing;
