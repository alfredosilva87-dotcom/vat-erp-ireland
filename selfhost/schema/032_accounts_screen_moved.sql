-- O plano de contas saiu do módulo Financeiro para o Contabilidade.
--
-- Mesma razão da migração 024: a árvore de permissões guarda o id da tela como
-- `<modulo>.<tela>`, e mudar o módulo muda o id. Quem tinha
-- `financeiro.accounts` ficaria com uma permissão que já não corresponde a
-- tela nenhuma — e, como um array sem o id significa "não pode", perderia o
-- acesso SEM AVISO.
update app_users
   set screen_access = (
         select array_agg(case when s = 'financeiro.accounts'
                               then 'contabilidade.accounts' else s end)
           from unnest(screen_access) as s
       )
 where screen_access is not null
   and 'financeiro.accounts' = any(screen_access);
