-- Árvore de permissões: de módulo para TELA.
--
-- A 012 gravava `module_access text[]` — módulo inteiro, grão grosso. Não dava
-- para liberar "Compras" sem entregar junto a leitura de documentos e a caixa
-- de entrada, que é exatamente o recorte que um escritório precisa fazer com
-- um estagiário. Aqui a permissão passa a ser a folha da árvore: uma tela.
--
-- `screen_access is null` = acesso total, e é o valor que toda linha sem
-- restrição ganha — ninguém perde acesso ao aplicar esta migração. Um array
-- não-nulo restringe às telas listadas (ver PERM_TREE em lib/permissions.ts).
-- Perfil `master` sempre vê tudo, independente do valor aqui.
--
-- A 012 nunca chegou a nenhuma instalação em produção: nasceu na mesma reforma
-- que esta. Por isso a coluna antiga sai em vez de ficar de enfeite — duas
-- fontes de verdade para "quem vê o quê" é como um usuário volta a enxergar
-- uma tela que alguém tinha tirado dele.
alter table app_users add column if not exists screen_access text[];

-- Quem já tinha restrição por módulo mantém o mesmo recorte, agora expandido
-- nas telas daquele módulo. Precisa casar com lib/modules.ts.
do $$
declare
  seg_of jsonb := '{
    "vendas":     ["sales"],
    "compras":    ["purchases", "analyze", "inbox", "suppliers"],
    "financeiro": ["bank", "accounts", "payable"],
    "fiscal":     ["obligations", "vat"],
    "rh":         ["hr"],
    "cadastro":   ["settings", "bright"]
  }'::jsonb;
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'app_users' and column_name = 'module_access'
  ) then
    update app_users u
    set screen_access = sub.ids
    from (
      select
        a.id,
        array_agg(m.key || '.' || s.seg) as ids
      from app_users a
      cross join lateral unnest(a.module_access) as m(key)
      cross join lateral jsonb_array_elements_text(seg_of -> m.key) as s(seg)
      where a.module_access is not null
      group by a.id
    ) sub
    where u.id = sub.id and u.screen_access is null;

    alter table app_users drop column module_access;
  end if;
end $$;
