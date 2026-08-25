-- A contabilidade saiu do módulo Fiscal e virou módulo próprio.
--
-- A árvore de permissões guarda o id da tela como `<modulo>.<tela>`, em
-- `app_users.screen_access`. Mudar o módulo muda o id: quem tinha
-- `fiscal.accounting` passaria a ter uma permissão que já não corresponde a
-- tela nenhuma, e — como nulo quer dizer "acesso total" mas um array sem o id
-- quer dizer "não pode" — a pessoa perderia a tela SEM AVISO, sem erro e sem
-- ninguém perceber até ela reclamar.
--
-- Por isso o id é reescrito aqui, e não deixado para trás. Quem tinha acesso
-- continua com ele.
update app_users
   set screen_access = (
         select array_agg(
                  case
                    when s = 'fiscal.accounting' then 'contabilidade.accounting'
                    when s = 'fiscal.ledger'     then 'contabilidade.ledger'
                    else s
                  end
                )
           from unnest(screen_access) as s
       )
 where screen_access is not null
   and screen_access && array['fiscal.accounting', 'fiscal.ledger'];
