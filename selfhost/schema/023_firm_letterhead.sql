-- O papel timbrado do escritório.
--
-- As demonstrações que saem daqui vão para a mão do cliente e, no caso das
-- abridged financial statements, para o CRO. Até agora o PDF saía com o nome
-- do CLIENTE no topo e mais nada — nenhuma indicação de quem preparou o
-- documento, que é o que distingue um relatório de escritório de uma tabela
-- impressa.
--
-- A tabela `companies` já guarda o escritório (é ela que sustenta o
-- multi-empresa e a licença). Faltavam-lhe os dados que um timbre pede. Ficam
-- todos NULOS por omissão, e o cabeçalho desenha só o que estiver preenchido:
-- um escritório que não pôs a morada tem de continuar a conseguir emitir o
-- balanço, e não um relatório com uma linha em branco no meio do timbre.
alter table companies
  add column if not exists address text,
  add column if not exists phone text,
  add column if not exists website text,
  -- Na Irlanda quem assina contas tem número de registo no seu instituto
  -- (CPA, ACCA, Chartered Accountants Ireland). Não é o CRO do cliente e não
  -- é o VAT do escritório: é a credencial de quem preparou.
  add column if not exists registration_no text,
  add column if not exists signer_name text,
  add column if not exists signer_title text;

comment on column companies.registration_no is
  'Numero de registo profissional de quem assina (CPA/ACCA/CAI), impresso no bloco de assinatura das demonstracoes.';
