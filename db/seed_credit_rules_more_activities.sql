-- =====================================================================
-- SEMENTE das regras de crédito por objeto social — atividades adicionais
-- =====================================================================
-- Estende db/seed_credit_rules.sql (que só cobria RESTAURANT e RETAIL) para
-- os demais tipos de negócio em lib/activities.ts. Mesma lógica: dada a
-- atividade da empresa e a descrição do item, pré-sugerir se o VAT é
-- dedutível. A decisão final é SEMPRE do usuário — isto é só a sugestão.
--
-- 'activity_code' = '*' significa "vale para qualquer empresa" (bloqueios
-- gerais já existentes em seed_credit_rules.sql continuam valendo, avaliados
-- primeiro por terem priority menor).
-- =====================================================================

-- ---------- WHOLESALE / DISTRIBUIÇÃO ----------
insert into credit_rules (activity_code, match_keywords, deductible_default, rationale, priority) values
('WHOLESALE', array['stock','goods for resale','inventory','pallet','warehouse'], true,
 'Goods for resale / warehousing — direct input, gives credit.', 50);

-- ---------- HOSPITALITY (hotel) ----------
insert into credit_rules (activity_code, match_keywords, deductible_default, rationale, priority) values
('HOSPITALITY', array['linen','towel','bedding','laundry','toiletries','cleaning product','detergent'], true,
 'Guest-room consumables — deductible.', 50),
('HOSPITALITY', array['prawn','prawns','shrimp','fish','meat','vegetable','flour','oil','ingredient'], true,
 'Kitchen input for the hotel restaurant — used in the taxable activity, gives credit.', 51),
('HOSPITALITY', array['kitchen equipment','oven','fridge','utensil','cookware'], true,
 'Kitchen equipment used in operations — deductible.', 52);

-- ---------- CONSTRUCTION / OBRAS ----------
insert into credit_rules (activity_code, match_keywords, deductible_default, rationale, priority) values
('CONSTRUCTION', array['cement','timber','brick','steel','plumbing','electrical','insulation','tile','paint','scaffolding','ppe','safety','tool','plant hire','machinery'], true,
 'Building materials/tools/plant used directly in construction works — deductible.', 50);

-- ---------- PROFESSIONAL SERVICES ----------
insert into credit_rules (activity_code, match_keywords, deductible_default, rationale, priority) values
('PROFESSIONAL', array['software','subscription','stationery','office supplies','printer','laptop','computer','license'], true,
 'Office/IT costs used in the professional service activity — deductible.', 50);

-- ---------- TRANSPORT / LOGÍSTICA ----------
insert into credit_rules (activity_code, match_keywords, deductible_default, rationale, priority) values
('TRANSPORT', array['diesel','fuel','tyre','tire','vehicle part','maintenance','spare part','freight','haulage','pallet'], true,
 'Commercial vehicle/logistics running costs — deductible. Does not affect the general block on passenger-car petrol.', 50);

-- ---------- AGRICULTURE / FARMING ----------
insert into credit_rules (activity_code, match_keywords, deductible_default, rationale, priority) values
('AGRICULTURE', array['feed','fertilizer','seed','seeds','livestock','veterinary','vet','tractor','fencing'], true,
 'Farm inputs used in the agricultural activity — deductible. Assumes normal VAT registration (not the Flat-Rate Farmers Scheme).', 50);

-- ---------- MANUFACTURING ----------
insert into credit_rules (activity_code, match_keywords, deductible_default, rationale, priority) values
('MANUFACTURING', array['raw material','component','parts','machinery','factory equipment','packaging','maintenance'], true,
 'Raw materials/production equipment used directly in manufacturing — deductible.', 50);

-- ---------- HEALTHCARE ----------
-- Sem regra geral de crédito automático: serviços de saúde na Irlanda
-- costumam ser VAT-exempt, o que tende a RESTRINGIR (não liberar) a
-- recuperação de VAT de compras ligadas à atividade. Regra abaixo só dá um
-- motivo mais específico que o catch-all genérico, mantendo-se conservadora.
insert into credit_rules (activity_code, match_keywords, deductible_default, rationale, priority) values
('HEALTHCARE', array['medical supplies','ppe','pharmaceutical','clinical equipment'], false,
 'Healthcare services are typically VAT-exempt in Ireland, which restricts input VAT recovery — review with the client''s tax advisor before taking credit (apportionment may apply).', 50);
