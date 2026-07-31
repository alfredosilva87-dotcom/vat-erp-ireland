-- =====================================================================
-- Default de crédito por cliente, para itens sem regra específica
-- ---------------------------------------------------------------------
-- Já aplicado em produção (projeto qimcehiwxalhvbcpyzvg) via MCP
-- apply_migration. Este arquivo documenta a migração para o histórico
-- do repo — não precisa ser reaplicado.
--
-- Antes: uma regra catch-all fixa em credit_rules ('*' / ['*'] / false /
--   priority 999) decidia TODO item que não batesse em nenhuma regra
--   específica — sempre "não sugerir crédito", igual para todo cliente.
-- Agora: esse comportamento é por cliente (clients.default_credit_unmatched,
--   default false = comportamento anterior preservado). A decisão vive em
--   lib/matching.ts (suggestCredit), que também ignora defensivamente
--   qualquer regra ['*'] que reapareça na base.
--
-- Os bloqueios gerais (entretenimento, gasolina de carro de passeio,
-- hospedagem — priority 10-12) continuam intactos e são avaliados ANTES
-- das regras por atividade, então nem o toggle do cliente os contorna.
-- =====================================================================

alter table clients add column default_credit_unmatched boolean not null default false;

delete from credit_rules where activity_code = '*' and match_keywords = array['*'];
