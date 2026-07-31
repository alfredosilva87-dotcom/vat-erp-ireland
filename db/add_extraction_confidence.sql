-- =====================================================================
-- Confiabilidade da leitura: validação real de conteúdo + escalonamento
-- para visão (Gemini) + sinalização de revisão humana.
-- ---------------------------------------------------------------------
-- Já aplicado em produção (projeto qimcehiwxalhvbcpyzvg) via MCP
-- apply_migration. Este arquivo documenta a migração para o histórico
-- do repo — não precisa ser reaplicado.
--
-- extraction_confidence: score real 0..1 calculado por
--   lib/extractor/validate.ts (scoreExtraction), substitui o valor fixo
--   que existia antes por engine.
-- needs_review: true quando o score final (depois de eventual
--   escalonamento para visão) ainda fica abaixo do limiar de revisão.
--   Pode ser limpo manualmente pelo contador (botão "Mark as reviewed"
--   em app/invoice/[id]/page.tsx).
-- review_notes: motivos legíveis do porquê o documento foi marcado
--   (histórico imutável do flag original, mesmo depois de revisado).
-- extraction_audit: array compacto [{engine, confidence}, ...] de cada
--   tentativa de leitura (texto, depois visão se escalou) — usado para
--   medir, com dado real, a taxa de escalonamento e ajustar os limiares.
-- =====================================================================

alter table invoices
  add column extraction_confidence numeric(4,3),
  add column needs_review boolean not null default false,
  add column review_notes text[] not null default '{}',
  add column extraction_audit jsonb not null default '[]';
