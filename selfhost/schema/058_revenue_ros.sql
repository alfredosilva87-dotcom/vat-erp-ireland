-- A LIGACAO AO ROS: o certificado do escritorio, e os RPN que a Revenue devolve.
--
-- ---------------------------------------------------------------------------
-- PORQUE ISTO EXISTE
--
-- Desde a PAYE Modernisation, o calculo da folha irlandesa NAO se faz so com
-- tabelas: faz-se com o RPN (Revenue Payroll Notification) que a Revenue emite
-- por EMPREGO. E o RPN que diz quantos creditos e que fatia da taxa normal
-- pertencem a ESTE emprego — porque quem tem dois empregos tem os creditos
-- repartidos entre eles, e nenhum dos dois empregadores sabe o que o outro
-- esta a usar.
--
-- Sem RPN, o motor tem de assumir a alocacao inteira, e quem tem dois empregos
-- fica com o desconto errado nos dois. Com RPN, o numero vem de quem manda.
--
-- ---------------------------------------------------------------------------
-- `revenue_credentials`: UMA POR EMPRESA, NAO POR CLIENTE
--
-- O certificado e do ESCRITORIO, nao do cliente final. O escritorio submete em
-- nome dos clientes usando o seu proprio certificado mais o TAIN de agente
-- (`agent_tain`), que e o que a Revenue usa para saber quem esta a falar por
-- quem. Um certificado por cliente seria pedir a cada cliente que entregasse a
-- sua credencial ao escritorio — que nao e como isto funciona nem como devia.
--
-- A CHAVE PRIVADA fica cifrada (AES-256-GCM, ver lib/revenue/cofre.ts), com uma
-- chave que vem de `REVENUE_CERT_KEY` e NAO da base de dados. Um despejo do
-- banco sozinho nao chega para assinar.
--
-- A SENHA DO `.p12` NAO E GUARDADA. Ela abre o ficheiro na importacao e acaba
-- ali; o que fica e a chave ja extraida.
--
-- ---------------------------------------------------------------------------
-- `revenue_rpn`: O QUE A REVENUE DISSE, COMO FACTO DATADO
--
-- Guarda-se a resposta, nao uma interpretacao dela. Um RPN e substituido por
-- outro mais recente (o `rpn_number` sobe), e o historico fica: quando alguem
-- perguntar porque e que o desconto mudou entre duas semanas, a resposta e um
-- RPN novo, e tem de ser possivel mostra-lo.
--
-- A chave natural e (empresa, employer_reg, ano, PPS, employment_id): e assim
-- que a Revenue identifica um emprego, e e o `employment_id` que separa os dois
-- empregos da mesma pessoa.

create table if not exists revenue_credentials (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,

  -- `test` enquanto se ensaia contra softwaretestnextversion.ros.ie;
  -- `production` contra www.ros.ie. Sao certificados diferentes, e trocar os
  -- dois e a maneira mais facil de submeter folha a serio por engano.
  environment       text not null default 'test'
                    check (environment in ('test','production')),

  -- O TAIN do agente. Vai como `agentTain` na query dos pedidos.
  agent_tain        text,

  -- O certificado (base64, sem cabecalhos PEM) — vai no campo `keyId`.
  certificate_b64   text not null,
  -- A chave privada CIFRADA. Ver lib/revenue/cofre.ts.
  private_key_enc   text not null,

  -- O que o certificado diz de si, para o ecra mostrar sem o mostrar.
  subject           text,
  issuer            text,
  fingerprint       text not null,
  valid_from        timestamptz,
  valid_to          timestamptz,

  -- A ultima vez que o "testar ligacao" correu, e o que respondeu.
  last_test_at      timestamptz,
  last_test_ok      boolean,
  last_test_message text,

  uploaded_by       uuid references app_users(id) on delete set null,
  created_at        timestamptz not null default now(),

  -- Um certificado por empresa e por ambiente: substituir o de producao nao
  -- pode apagar o de teste, senao perde-se a forma de ensaiar.
  unique (company_id, environment)
);

create index if not exists idx_revenue_credentials_company on revenue_credentials(company_id);

create table if not exists revenue_rpn (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  client_id             uuid references clients(id) on delete cascade,

  employer_reg          text not null,
  tax_year              int  not null,
  employee_ppsn         text not null,
  -- O que separa os DOIS empregos da mesma pessoa. Sem isto, o RPN do emprego
  -- A sobrescreveria o do emprego B e o desconto sairia errado nos dois.
  employment_id         text not null,

  rpn_number            text,
  rpn_issue_date        date,
  effective_date        date,
  end_date              date,

  -- CUMULATIVE | WEEK1 | EMERGENCY. Vem de quem manda, e nao de uma caixa que
  -- alguem escolheu no cadastro.
  calculation_basis     text,

  -- Em CENTIMOS, como todo o modulo de folha. Guardar euros com virgula aqui
  -- seria a unica excepcao do sistema, e as excepcoes e que produzem os erros
  -- de arredondamento que ninguem encontra.
  yearly_tax_credits    bigint,
  yearly_cut_off        bigint,
  pay_tax_to_date       bigint,
  tax_deducted_to_date  bigint,
  pay_usc_to_date       bigint,
  usc_deducted_to_date  bigint,
  lpt_to_deduct         bigint,

  usc_status            text,
  -- Os escaloes de USC e as taxas de imposto, tal como vieram. JSON porque sao
  -- listas de tamanho variavel e porque o que interessa e guardar o que ELES
  -- disseram, nao a nossa leitura disso.
  usc_rates             jsonb,
  tax_rates             jsonb,

  -- A resposta inteira, para poder responder "porque e que o desconto mudou?".
  raw                   jsonb,

  fetched_at            timestamptz not null default now(),

  unique (company_id, employer_reg, tax_year, employee_ppsn, employment_id)
);

create index if not exists idx_revenue_rpn_cliente on revenue_rpn(client_id, tax_year);
create index if not exists idx_revenue_rpn_pps on revenue_rpn(employee_ppsn, tax_year);

comment on table revenue_credentials is
  'Certificado ROS do ESCRITORIO (um por empresa e ambiente). Chave privada cifrada; a senha do .p12 nunca e guardada.';
comment on table revenue_rpn is
  'O que a Revenue devolveu por emprego. E o RPN que decide creditos e cut-off de quem tem mais de um emprego.';
