-- PLANO DE CONTAS: um só, com faixa reservada para contas próprias do cliente.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTAVA CONTRADITÓRIO
--
-- Havia DOIS índices únicos a discordar:
--   `idx_coa_code`                      — único no código sozinho
--   `chart_of_accounts_client_code_idx` — único em (client_id, code)
--
-- O primeiro vencia: um cliente que tentasse criar a conta 1100 levava um erro
-- cru do Postgres na cara. Ou seja, o sistema JÁ era de plano único, sem que
-- isso estivesse escrito em lado nenhum — e o `createAccount` continuava a
-- pedir conflito em (client_id, code), que nunca era o índice que disparava.
--
-- Pior: o segundo índice não protegia sequer o plano partilhado. Em Postgres
-- dois NULOS não são iguais, então `(null, '1100')` duas vezes passaria.
--
-- ---------------------------------------------------------------------------
-- A DECISÃO (Alfredo, 2026-08-25): PLANO ÚNICO
--
-- Os relatórios agrupam por `report_group` e nunca olham para o código, então
-- um plano só não custa nada na aparência do balanço ou do DRE. O ganho é o
-- classificador: com 35 clientes num vocabulário, a regra aprendida num serve
-- aos outros. E o analista, que troca de empresa o dia inteiro, aprende um
-- plano em vez de trinta e cinco.
--
-- Quem chega com plano próprio entra pelo de-para (`account_mapping`), que já
-- existe para isso.
--
-- A válvula: a faixa 9000–9899 fica para contas PRÓPRIAS de um cliente —
-- análise que mais ninguém precisa. 9900–9999 fica para contas de sistema
-- (arredondamento). Fora dessas faixas, a conta é do escritório e vive no
-- plano partilhado.
-- ---------------------------------------------------------------------------

-- 1) As quatro contas por cliente que existem são genéricas e boas: passam a
--    ser do escritório. Nenhum lançamento se parte — o código não muda.
update chart_of_accounts set client_id = null
 where client_id is not null and code in ('6200', '6300', '6400');

-- 2) 9999 é conta de SISTEMA (CONTAS_PADRAO.rounding) e não estava no plano
--    partilhado — se alguma vez uma linha de arredondamento fosse lançada,
--    apontaria para uma conta que não existe.
delete from chart_of_accounts where client_id is not null and code = '9999';
insert into chart_of_accounts (code, description, type, report_group, postable, client_id, active)
values ('9999', 'Rounding differences', 'expense', 'administrative_expenses', true, null, true)
on conflict do nothing;

-- 3) Os índices passam a dizer a verdade.
drop index if exists idx_coa_code;
drop index if exists chart_of_accounts_client_code_idx;

-- O plano do escritório: um código, uma conta.
create unique index if not exists idx_coa_shared_code
  on chart_of_accounts (code) where client_id is null;

-- As contas próprias: únicas dentro do cliente.
create unique index if not exists idx_coa_client_code
  on chart_of_accounts (client_id, code) where client_id is not null;

-- 4) E a faixa, imposta pelo banco e não só pela tela: uma conta de cliente
--    nunca pode sombrear um código do escritório.
alter table chart_of_accounts drop constraint if exists chk_coa_client_range;
alter table chart_of_accounts add constraint chk_coa_client_range
  check (client_id is null or (code >= '9000' and code <= '9899'));
