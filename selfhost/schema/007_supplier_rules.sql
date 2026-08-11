-- =====================================================================
-- Camada B1 — regra por fornecedor.
--
-- O sistema já tinha o primeiro e o terceiro nível de decisão: a escolha
-- manual do contador na nota, e o que o sistema aprendeu (`items_master`,
-- `client_item_accounts`). Faltava o do meio, que é justamente o que o
-- contador mais controla no dia a dia: "toda nota da Vodafone vai para
-- telecomunicações, 23%, e não me interessa o detalhe das linhas".
--
-- A precedência é: ESCOLHA MANUAL > REGRA DE FORNECEDOR > APRENDIDO.
-- Fica assim porque a regra é uma decisão que o contador tomou de propósito e
-- escreveu; o aprendido é estatística sobre o que ele fez antes. Estatística
-- não pode sobrepor decisão explícita, senão a regra parece não funcionar.
--
-- CAMPO VAZIO NÃO DECIDE NADA. Uma regra pode dizer só a conta contábil e
-- deixar a alíquota em branco — é assim que um supermercado ganha destino
-- contábil sem ter as alíquotas das suas linhas (23%, 13,5%, 0%) esmagadas
-- por um número só.
--
-- A alíquota NÃO é guardada aqui, só a categoria de VAT. A alíquota vem da
-- categoria (`vat_categories.vat_rate`), que é onde ela já mora. Guardar as
-- duas criaria duas versões da mesma verdade, e no dia em que a Revenue mudar
-- uma alíquota a regra continuaria com a antiga — mesma razão pela qual a
-- situação de pagamento é view e não coluna (camada A0).
-- =====================================================================

create table if not exists supplier_rules (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,

  -- Como a regra aparece na tela. Não participa do casamento.
  label       text not null,

  -- ---- como o fornecedor é reconhecido ----
  -- Número de VAT: o reconhecimento forte. Guardado já normalizado (só letras
  -- e dígitos, maiúsculas) para que "IE 1234567 X" e "ie1234567x" sejam a
  -- mesma coisa — normalizar na leitura deixaria a unicidade abaixo furada.
  supplier_vat text,
  -- Pedaço do nome que precisa aparecer, guardado minúsculo e sem acento.
  -- Quando dois nomes casam, ganha o padrão mais longo: "tesco express" é
  -- mais específico que "tesco", e é o que o contador quis dizer.
  name_match  text,

  -- ---- o que a regra decide (nulo = não opina) ----
  account_code      text,
  account_name      text,
  vat_category_code text,

  -- Interruptor de itens de linha. Ligado é o comportamento de sempre.
  -- Desligado, o documento entra como UMA linha com os totais dele — e a
  -- classificação por IA não roda, que é a economia real de tempo e custo.
  extract_line_items boolean not null default true,

  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Duas regras para o mesmo número de VAT (ou para o mesmo pedaço de nome) do
-- mesmo cliente são sempre erro de cadastro: uma delas nunca ia acontecer e
-- ninguém descobriria. O banco recusa, em vez de a tela avisar — é a mesma
-- lição da camada A1, onde o anti-duplicata é do banco e não do código.
create unique index if not exists idx_supplier_rules_vat
  on supplier_rules(client_id, supplier_vat) where supplier_vat is not null;
create unique index if not exists idx_supplier_rules_name
  on supplier_rules(client_id, name_match) where name_match is not null;
create index if not exists idx_supplier_rules_client
  on supplier_rules(client_id, active);

-- Uma regra que não reconhece ninguém casaria com tudo ou com nada, e as duas
-- possibilidades são estrago. Exigir ao menos uma forma de reconhecimento aqui
-- evita que um cadastro pela metade fique guardado parecendo válido.
do $$ begin
  alter table supplier_rules
    add constraint supplier_rules_needs_identifier
    check (supplier_vat is not null or name_match is not null);
exception when duplicate_object then null;
end $$;

alter table supplier_rules enable row level security;
