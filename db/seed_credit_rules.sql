-- =====================================================================
-- SEMENTE das regras de crédito por objeto social
-- =====================================================================
-- Lógica: dada a atividade da empresa (companies.activity_code) e a
-- categoria/descrição do item, pré-sugerir se o VAT é dedutível (crédito).
-- A decisão final é SEMPRE do usuário — isto é só a sugestão.
--
-- Regra geral na Irlanda: VAT é dedutível quando o gasto é para a
-- atividade tributável do negócio. Alguns itens são bloqueados por lei
-- (entretenimento, refeições/hospedagem, combustível de carro de passeio).
--
-- 'activity_code' = '*' significa "vale para qualquer empresa".
-- Avaliação por 'priority' crescente (menor primeiro); a primeira regra
-- que casar decide.
-- =====================================================================

-- ---------- BLOQUEIOS GERAIS (valem para qualquer atividade) ----------
insert into credit_rules (activity_code, match_keywords, deductible_default, rationale, priority, updated_by) values
('*', array['entertainment','client entertainment','hospitality event','entretenimento'], false,
 'Entretenimento não é dedutível na Irlanda (bloqueio legal).', 10, 'seed'),
('*', array['petrol','gasolina'], false,
 'Combustível de carro de passeio (gasolina) geralmente não é dedutível.', 11, 'seed'),
('*', array['hotel','accommodation','hospedagem'], false,
 'Hospedagem/refeições fora podem ter dedução restrita — revisar.', 12, 'seed');

-- ---------- RESTAURANTE / CATERING ----------
-- Insumos de cozinha => crédito (ex.: camarão/prawns é insumo).
insert into credit_rules (activity_code, match_keywords, deductible_default, rationale, priority, updated_by) values
('RESTAURANT', array['prawn','prawns','shrimp','fish','meat','vegetable','flour','oil','ingredient','camarao','peixe','carne'], true,
 'Insumo da cozinha do restaurante — usado na atividade tributável, gera crédito.', 50, 'seed'),
('RESTAURANT', array['kitchen equipment','oven','fridge','utensil','equipamento'], true,
 'Equipamento de cozinha usado na operação — dedutível.', 51, 'seed'),
('RESTAURANT', array['cleaning product','detergent','packaging','napkin','detergente'], true,
 'Materiais de consumo da operação — dedutíveis.', 52, 'seed');

-- ---------- VAREJO / MERCADO (revenda) ----------
insert into credit_rules (activity_code, match_keywords, deductible_default, rationale, priority, updated_by) values
('RETAIL', array['stock','goods for resale','inventory','revenda','estoque'], true,
 'Mercadoria para revenda — insumo direto, gera crédito.', 50, 'seed');

-- ---------- REGRA PADRÃO (fallback) ----------
-- Se nada específico casar, sugerir crédito para itens com VAT>0 ligados
-- ao negócio, mas deixar em revisão. Aqui deixamos como NÃO sugerido por
-- segurança, forçando o usuário a confirmar.
insert into credit_rules (activity_code, match_keywords, deductible_default, rationale, priority, updated_by) values
('*', array['*'], false,
 'Sem regra específica — revisar manualmente antes de tomar crédito.', 999, 'seed');
