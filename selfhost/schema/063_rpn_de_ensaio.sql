-- O RPN DE ENSAIO diz-se ENSAIO nos proprios dados.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA COLUNA, E NAO UMA CONVENCAO NO NUMERO DO RPN
--
-- Nao ha certificado ROS instalado e nao vai haver tao cedo, mas e preciso
-- demonstrar a folha com acumulados e creditos VINDOS da Revenue — que e a
-- parte que muda o desconto de quem entra a meio do ano. Sem forma de semear
-- esses dados, a demonstracao mostra sempre o caso pobre.
--
-- Semear e facil; o perigo e o dado semeado passar por verdadeiro. O numero do
-- RPN sai com prefixo `SIM-` e isso ja se ve no recibo, mas uma convencao num
-- campo de texto e uma convencao: basta alguem editar a linha, ou copiar um
-- registo, para ela deixar de valer. A coluna nao se perde numa copia e da para
-- filtrar — e e por ela que a limpeza sabe o que pode apagar.
--
-- `default false` e nao nulo: uma linha que veio mesmo da Revenue nunca fica
-- ambigua, e quem consultar a tabela sem saber desta migracao le o que espera.
-- ---------------------------------------------------------------------------

alter table revenue_rpn
  add column if not exists simulated boolean not null default false;

comment on column revenue_rpn.simulated is
  'ENSAIO: esta linha NAO veio da Revenue — foi semeada para demonstracao. So se '
  'cria em clientes de demonstracao (codigo DEMO-), por acto deliberado de um '
  'administrador, e e a unica coisa que a limpeza do ensaio apaga. Ver '
  'app/api/hr/companies/[id]/revenue-rehearsal.';

create index if not exists idx_revenue_rpn_simulado
  on revenue_rpn(client_id, tax_year) where simulated;
