-- O QUE UM PAGAMENTO PRECISA DE SABER, e o e-mail do recibo.
--
-- ---------------------------------------------------------------------------
-- POR QUE O TITULO NAO CHEGAVA PARA PAGAR
--
-- `ledger_items` ja tinha beneficiario (`counterparty`), valor
-- (`original_amount`) e vencimento (`due_date`). Faltavam as duas coisas sem as
-- quais nenhuma ordem de pagamento sai de um banco: a CONTA para onde o
-- dinheiro vai, e a REFERENCIA que o recebedor usa para saber a que se refere.
--
-- Sem elas, quem quisesse ligar isto ao banco tinha de ir buscar o IBAN a
-- outro sitio a cada pagamento — e "outro sitio" acabava por ser um papel na
-- gaveta, que e como um pagamento vai parar a conta errada.
--
-- Isto NAO constroi o envio ao banco. Deixa o titulo pronto para o dia em que
-- ele existir; o ficheiro SEPA, a autorizacao e o envio sao trabalho proprio.
-- ---------------------------------------------------------------------------

alter table ledger_items
  add column if not exists payee_iban text,
  add column if not exists payment_reference text;

comment on column ledger_items.payee_iban is
  'IBAN do beneficiario, quando o pagamento e para uma conta so. Nulo no titulo '
  'do liquido da folha: ali o dinheiro vai para N contas, uma por funcionario — '
  'o IBAN esta em hr_employees.iban.';
comment on column ledger_items.payment_reference is
  'A referencia que o recebedor le no extrato dele. Nos titulos da folha e a '
  'mesma do document_ref (FOLHA 2026-M09 LIQ / IMP).';

-- ---------------------------------------------------------------------------
-- O FUNCIONARIO: onde mandar o recibo, e para onde vai o salario
--
-- Nao havia campo nenhum de contacto em `hr_employees` — o recibo so se
-- entregava a mao ou imprimindo o PDF. E o IBAN vive na pessoa, e nao no
-- titulo, porque o pagamento do liquido e uma transferencia POR PESSOA: um
-- unico IBAN no titulo mandaria o salario de toda a gente para a conta de uma
-- so.
-- ---------------------------------------------------------------------------
alter table hr_employees
  add column if not exists email text,
  add column if not exists iban text;

comment on column hr_employees.email is
  'Para onde vai o recibo. Vazio significa entrega em mao: o envio recusa e diz '
  'de quem falta o endereco, em vez de mandar para lado nenhum.';
comment on column hr_employees.iban is
  'Conta para onde vai o liquido. Guardado sem validacao de formato de '
  'proposito: um IBAN estrangeiro valido nao passa numa regra escrita para o '
  'irlandes, e recusar o cadastro de alguem por causa disso e pior do que '
  'aceitar o que a pessoa escreveu.';

-- ---------------------------------------------------------------------------
-- O RECIBO ENVIADO fica registado NA LINHA DO RECIBO
--
-- Tabela propria seria um join a mais para responder a pergunta que se faz
-- sempre — "ja mandei o recibo desta pessoa deste mes?". `hr_payslip` ja e
-- unico por (funcionario, ano, periodo, frequencia), que e exactamente a chave
-- da pergunta.
--
-- Guarda-se o ENDERECO usado e nao so a data: o e-mail do cadastro muda, e
-- meses depois "enviado" sem dizer para onde nao prova nada a quem diz que
-- nunca recebeu.
-- ---------------------------------------------------------------------------
alter table hr_payslip
  add column if not exists emailed_at timestamptz,
  add column if not exists emailed_to text,
  add column if not exists emailed_by uuid references app_users(id);

comment on column hr_payslip.emailed_at is
  'Quando o recibo foi enviado por e-mail. Nulo = nunca enviado. O ecra avisa '
  'antes de repetir, em vez de mandar duas vezes sem ninguem saber.';
