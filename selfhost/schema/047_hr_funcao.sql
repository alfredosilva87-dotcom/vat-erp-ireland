-- A FUNCAO do funcionario.
--
-- Pedido do Alfredo (2026-09-02): "criar funcionarios nas empresas que ja temos
-- com salarios diferentes e funcoes diferentes com horas diferentes".
--
-- Salario, horas e frequencia ja se guardavam. A FUNCAO nao — nao havia onde a
-- por. E ela nao e enfeite de cadastro:
--
--   * o payslip mostra-a, e um recibo sem cargo nao passa por documento serio;
--   * "quanto gastamos em cozinha" e uma pergunta que o escritorio faz, e sem
--     a funcao a resposta e somar a mao olhando para os nomes;
--   * a classe de PRSI e a taxa dependem do tipo de trabalho, e sem o cargo
--     escrito a escolha fica na cabeca de quem lanca.
--
-- Texto livre e nao lista fechada, de proposito: a lista de cargos de um
-- restaurante nao e a de uma empresa de transportes, e uma lista fechada
-- obrigaria a pedir uma alteracao do sistema a cada cliente novo.
alter table hr_employees
  add column if not exists job_title text;

comment on column hr_employees.job_title is
  'Funcao/cargo. Texto livre: a lista de um restaurante nao e a de um transportador.';
