-- =====================================================================
-- Regras de item bloqueado (VAT Consolidation Act 2010, s.60) e
-- precedencia das regras de combustivel.
-- ---------------------------------------------------------------------
-- Ja aplicado em producao via MCP apply_migration. Documenta o historico.
--
-- Contexto: as palavras-chave passaram a casar tambem com a CATEGORIA do
-- item, nao so com a descricao. Recibos trazem descricoes cripticas
-- ("milesPLUS C", "PRNGLE POP BBQ") e a categoria e o unico lugar onde a
-- natureza real da compra aparece.
--
-- Cuidado com a ordem: a categoria "Vehicle fuel (petrol/diesel)" contem a
-- palavra "petrol", entao uma regra generica de petrol disparava em linhas de
-- diesel e dizia ao contador que petrol e bloqueado — resultado conservador,
-- justificativa errada. Por isso o bloqueio duro de petrol usa termos que so
-- aparecem em petrol de verdade ("unleaded"), e o resto do combustivel cai
-- numa regra que pede confirmacao da grade.
-- =====================================================================

delete from credit_rules where activity_code = '*' and priority in (5, 6);

insert into credit_rules (activity_code, match_keywords, deductible_default, rationale, priority) values
('*', array['unleaded','super unleaded','petrol 95'], false,
 'Petrol is a blocked item in Ireland — input VAT is never recoverable, regardless of business use.', 5),
('*', array['diesel','vehicle fuel','fuel card','forecourt','petrol'], false,
 'Fuel: diesel for a commercial vehicle is recoverable, petrol never is. Confirm the grade and the business use before claiming.', 6),
('*', array['confectionery','chocolate','savoury snack','crisps','soft drink','biscuit','sweets','snack'], false,
 'Food and drink for own or staff consumption is a blocked item. Only claim if this was bought as stock for resale.', 7),
('*', array['restaurant meal','takeaway','catering service','personal service'], false,
 'Meals and personal services are blocked items for input VAT in Ireland.', 8);

-- Substituida pela regra de prioridade 6.
delete from credit_rules
where activity_code = '*' and match_keywords = array['petrol'] and priority = 11;
