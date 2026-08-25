-- De onde a nota entrou.
--
-- A fila (`inbox_items.source`) já sabia distinguir e-mail de telefone desde a
-- camada B4, mas a informação MORRIA na gravação: virada nota, ninguém mais
-- conseguia dizer se aquele documento veio do arquivo escolhido à mão, da
-- caixa de e-mail, ou da foto que o cliente tirou no posto. É justamente essa
-- a pergunta que o escritório faz quando quer saber se a entrada automática
-- está valendo a pena — e ela não tinha resposta.
--
-- Texto livre, não enum, pelo mesmo motivo de `recurring_obligations`: a
-- próxima porta de entrada (WhatsApp, portal do fornecedor) não deve exigir
-- migração de schema pra ser contada.
--
-- `null` = nota anterior a esta mudança. Não é "desconhecida por erro": é
-- "gravada quando o sistema ainda não guardava isso", e a tela diz assim.
alter table invoices add column if not exists source text;
create index if not exists idx_invoices_source on invoices(source);
