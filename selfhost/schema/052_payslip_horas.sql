-- O payslip mostra as horas — ou nao.
--
-- Pedido dele (2026-09-02): "em um payslip normal mostra as horas, mas deixa
-- opcional no payslip mostrar as horas trabalhadas ou nao".
--
-- No payslip do Sage dele a coluna HOURS existe e vem VAZIA, porque ele e
-- salariado: o Sage mantem a coluna sempre e enche-a so quando ha horas. Mas
-- uma empresa toda de salariados nao quer uma coluna vazia em todos os recibos,
-- e uma empresa de horistas quer as horas a vista — sao decisoes diferentes,
-- por empresa, e por isso e um campo e nao uma regra.
--
-- Fica em `hr_client` (o cabecalho da folha da empresa) e nao no funcionario:
-- e uma decisao de LAYOUT do recibo daquele empregador, e um recibo diferente
-- por pessoa dentro da mesma empresa e o tipo de coisa que faz alguem perguntar
-- se o sistema esta partido.
alter table hr_client
  add column if not exists payslip_show_hours boolean not null default true;

comment on column hr_client.payslip_show_hours is
  'Mostrar as horas trabalhadas no payslip. Verdadeiro por omissao: e o normal, e quem nao as quer tira-as.';
