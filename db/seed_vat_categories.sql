-- =====================================================================
-- SEMENTE da base de alíquotas VAT (Irlanda)
-- =====================================================================
-- ATENÇÃO: esta é uma AMOSTRA representativa das categorias mais comuns,
-- para o app já funcionar. NÃO é a base completa do Revenue.
-- O contador/analista deve VALIDAR e AMPLIAR (tela de gestão da base).
--
-- Vigência considerada: a partir de 01/07/2026, quando alimentação,
-- catering e cabeleireiro passaram de 13,5% para 9%.
-- Fonte: revenue.ie/.../vat-rates-database.aspx
-- =====================================================================

insert into vat_categories (code, description, keywords, vat_rate, rate_type, effective_from, revenue_ref, updated_by) values

-- ---------- 0% (ZERO) — a maioria dos alimentos crus/básicos ----------
('FOOD-BASIC', 'Comida básica (não preparada): pão, leite, chá, café, farinha, açúcar', array['bread','milk','tea','coffee','flour','sugar','pao','leite'], 0.0, 'zero', '2000-01-01', 'seed', 'seed'),
('FOOD-VEG',   'Vegetais e frutas frescos', array['vegetable','fruit','potato','onion','carrot','apple','vegetais','frutas'], 0.0, 'zero', '2000-01-01', 'seed', 'seed'),
('FOOD-MEAT',  'Carne crua / não preparada', array['beef','chicken','pork','lamb','meat','carne','frango'], 0.0, 'zero', '2000-01-01', 'seed', 'seed'),
('FOOD-FISH',  'Peixe e marisco crus (ex.: camarão/prawns)', array['fish','prawn','prawns','shrimp','salmon','cod','marisco','camarao','peixe'], 0.0, 'zero', '2000-01-01', 'seed', 'seed'),
('CHILD-CLOTH','Roupas e calçados infantis', array['children clothing','kids shoes','baby','infantil'], 0.0, 'zero', '2000-01-01', 'seed', 'seed'),
('MED-ORAL',   'Medicamentos orais', array['oral medicine','tablets','medication','medicamento'], 0.0, 'zero', '2000-01-01', 'seed', 'seed'),
('BOOKS',      'Livros (impressos)', array['book','books','livro'], 0.0, 'zero', '2000-01-01', 'seed', 'seed'),

-- ---------- 9% (SEGUNDA REDUZIDA) — mudança de 01/07/2026 ----------
('CATERING',   'Serviços de restaurante e catering (refeições prontas)', array['restaurant','catering','meal','food service','hot food','takeaway','refeicao'], 9.0, 'second_reduced', '2026-07-01', 'Mudança 01/07/2026: 13,5% -> 9%', 'seed'),
('HAIRDRESS',  'Serviços de cabeleireiro', array['hairdresser','hairdressing','haircut','salon','cabeleireiro'], 9.0, 'second_reduced', '2026-07-01', 'Mudança 01/07/2026: 13,5% -> 9%', 'seed'),
('NEWS',       'Jornais e periódicos, e-books', array['newspaper','magazine','ebook','e-book','jornal'], 9.0, 'second_reduced', '2000-01-01', 'seed', 'seed'),
('SPORT',      'Instalações esportivas (uso)', array['gym','sports facility','leisure centre','academia'], 9.0, 'second_reduced', '2000-01-01', 'seed', 'seed'),

-- ---------- 13,5% (REDUZIDA) ----------
('FUEL-DOM',   'Combustível doméstico: carvão, turfa, óleo de aquecimento', array['coal','peat','heating oil','briquettes','carvao'], 13.5, 'reduced', '2000-01-01', 'seed', 'seed'),
('ELEC-GAS',   'Eletricidade e gás (uso geral)', array['electricity','gas','esb','energia','eletricidade'], 13.5, 'reduced', '2000-01-01', 'CONFERIR: houve 9% temporário; validar vigência', 'seed'),
('CONSTRUCT',  'Serviços de construção e reforma', array['construction','building work','repair service','plumber','electrician','reforma'], 13.5, 'reduced', '2000-01-01', 'seed', 'seed'),
('CLEANING',   'Serviços de limpeza e manutenção', array['cleaning service','maintenance','limpeza'], 13.5, 'reduced', '2000-01-01', 'seed', 'seed'),

-- ---------- 4,8% (PECUÁRIA) ----------
('LIVESTOCK',  'Gado vivo (bovinos, ovinos, cavalos, galgos)', array['cattle','sheep','livestock','horse','greyhound','gado'], 4.8, 'livestock', '2000-01-01', 'seed', 'seed'),

-- ---------- 23% (PADRÃO) — a maior parte de bens/serviços ----------
('ALCOHOL',    'Bebidas alcoólicas', array['beer','wine','spirits','guinness','vodka','whiskey','cerveja','vinho'], 23.0, 'standard', '2000-01-01', 'seed', 'seed'),
('SOFTDRINK',  'Refrigerantes e bebidas açucaradas', array['soft drink','cola','coke','soda','energy drink','refrigerante'], 23.0, 'standard', '2000-01-01', 'seed', 'seed'),
('ELECTRONIC', 'Eletrônicos e eletrodomésticos', array['electronics','laptop','phone','appliance','computer','eletronico'], 23.0, 'standard', '2000-01-01', 'seed', 'seed'),
('ADULT-CLOTH','Roupas e calçados adultos', array['clothing','shoes','adult clothing','roupa adulto'], 23.0, 'standard', '2000-01-01', 'seed', 'seed'),
('FURNITURE',  'Móveis', array['furniture','table','chair','desk','movel'], 23.0, 'standard', '2000-01-01', 'seed', 'seed'),
('CLEANING-PR','Produtos de limpeza', array['detergent','cleaning product','bleach','soap','detergente'], 23.0, 'standard', '2000-01-01', 'seed', 'seed'),
('STATIONERY', 'Papelaria e material de escritório', array['stationery','paper','pen','printer ink','papelaria'], 23.0, 'standard', '2000-01-01', 'seed', 'seed'),
('FUEL-AUTO',  'Combustível de veículo (gasolina/diesel)', array['petrol','diesel','fuel','gasolina'], 23.0, 'standard', '2000-01-01', 'seed', 'seed'),

-- ---------- ISENTO ----------
('FINANCE',    'Serviços financeiros e seguros', array['insurance','financial service','bank fee','seguro'], 0.0, 'exempt', '2000-01-01', 'seed', 'seed'),
('MEDICAL',    'Serviços médicos e de saúde', array['doctor','medical service','dental','gp','medico'], 0.0, 'exempt', '2000-01-01', 'seed', 'seed'),
('EDUCATION',  'Serviços educacionais', array['education','training course','school','curso'], 0.0, 'exempt', '2000-01-01', 'seed', 'seed');
