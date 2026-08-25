-- Papelaria e correios — a rubrica que faltava.
--
-- Apareceu ao classificar os documentos de teste: "papel A4 e toner" não
-- tinha conta própria e caía em "Other expenses" junto de tudo o mais.
-- É uma linha padrão de qualquer plano irlandês (printing, postage and
-- stationery), e sem ela o DRE junta material de escritório com o que
-- ninguém soube classificar — que são coisas diferentes e devem ficar
-- separadas, senão "Other expenses" cresce e ninguém sabe do quê.
insert into chart_of_accounts (code, description, type, report_group, postable, client_id, active)
values ('6750', 'Printing, postage and stationery', 'expense', 'administrative_expenses', true, null, true)
on conflict do nothing;
