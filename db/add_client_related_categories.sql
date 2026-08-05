-- =====================================================================
-- Categorias que o cliente vende/usa, para o aviso de "item não
-- relacionado ao negócio"
-- ---------------------------------------------------------------------
-- Já aplicado em produção (projeto qimcehiwxalhvbcpyzvg) via MCP
-- apply_migration. Este arquivo documenta a migração para o histórico
-- do repo — não precisa ser reaplicado.
--
-- clients.related_categories guarda os vat_categories.code escolhidos no
-- cadastro do cliente (ex.: restaurante -> comida, bebida, insumo de
-- cozinha...). Vazio ('{}', o default) significa "não configurado" — o
-- aviso fica desligado para esse cliente até o contador escolher algo,
-- então clientes existentes não são afetados até optarem.
-- =====================================================================

alter table clients add column if not exists related_categories text[] not null default '{}';
