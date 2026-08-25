-- OS TIPOS DE ENCARGO, e a conta de cada um em CADA LADO.
--
-- ---------------------------------------------------------------------------
-- O ERRO QUE ISTO CONSERTA
--
-- A tela mandava a conta do encargo com o número escrito no código: juros →
-- 7100, sempre. Num título a PAGAR está certo — 7100 "Interest payable" é
-- despesa de juros. Num título a RECEBER, não: o juro que o cliente nos paga é
-- GANHO, e a partida saía a creditar uma conta de despesa
-- (1200 D / 7100 C), o que empurra o resultado para o lado errado e não fecha
-- com nada.
--
-- O mesmo vale para o desconto, ao contrário: desconto obtido de um fornecedor
-- é ganho; desconto concedido a um cliente é despesa.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA TABELA E NÃO UM `if` NO CÓDIGO
--
-- Pedido do Alfredo: "seria interessante ter um cadastro desses códigos de
-- baixas para facilitar o que aplicar, até mesmo para fazer ajustes". Tem
-- razão — a conta certa para "multa" depende do escritório e do plano, e um
-- número escrito no código só se muda com um deploy. Aqui muda-se na tela.
-- ---------------------------------------------------------------------------
create table if not exists charge_types (
  key text primary key,
  label text not null,

  -- A conta de RESULTADO de cada lado. A contrapartida é sempre a conta de
  -- controlo do título (fornecedores ou clientes) e não se configura: ela é
  -- consequência da natureza do título, não escolha.
  account_payable text not null,
  account_receivable text not null,

  -- 'increase' aumenta o que se deve/recebe; 'decrease' abate. O desconto é o
  -- único que abate — e é por isso que ele inverte as contas.
  effect text not null default 'increase' check (effect in ('increase', 'decrease')),

  sort integer not null default 100,
  active boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into charge_types (key, label, account_payable, account_receivable, effect, sort) values
  ('interest', 'Juros',    '7100', '4900', 'increase', 10),
  ('fee',      'Taxa',     '6990', '4900', 'increase', 20),
  ('penalty',  'Multa',    '6990', '4900', 'increase', 30),
  ('other',    'Despesa',  '6990', '4900', 'increase', 40),
  ('discount', 'Desconto', '4900', '6990', 'decrease', 50)
on conflict (key) do nothing;

comment on table charge_types is
  'Tipos de encargo do titulo e a conta de resultado em cada lado. Ver postCharge em lib/accounting/post.ts.';
