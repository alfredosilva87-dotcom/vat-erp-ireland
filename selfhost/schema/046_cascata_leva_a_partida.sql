-- A CASCATA passa a levar a partida do razao com ela.
--
-- ---------------------------------------------------------------------------
-- O BURACO
--
-- `ledger_settlements.ledger_item_id` e `ledger_charges.ledger_item_id` apontam
-- a `ledger_items` com ON DELETE CASCADE. `journal` nao aponta a nada disso.
--
-- Apagar um titulo levava as baixas e os encargos dele DENTRO do banco, sem
-- passar pelo codigo, e as partidas ficavam. Foi assim que a conta 812 do
-- DEMO-DUB ficou com -34,20 sem nada que o explicasse: duas baixas (13,00 e
-- 24,00) e um encargo (2,80) sem linha de origem nenhuma.
--
-- A v1.37 deu a ferramenta para limpar. Isto e o que impede de voltar a sujar.
--
-- ---------------------------------------------------------------------------
-- POR QUE GATILHO, E NAO ARRUMAR OS CAMINHOS DA APLICACAO
--
-- Porque os caminhos da aplicacao JA estavam certos. `DELETE /titles/x/settle`
-- apaga a partida antes da linha; `descontabilizarEncargo` faz o mesmo. O que
-- falhou nao foi nenhum deles — foi a cascata, que nao os consulta.
--
-- Uma regra que so vale nos caminhos de que alguem se lembrou nao e uma regra.
-- E a mesma decisao da partida dobrada e do cadeado do periodo: a trava fica no
-- unico sitio por onde todos passam.
--
-- ---------------------------------------------------------------------------
-- O QUE ACONTECE EM PERIODO FECHADO
--
-- O cadeado da migracao 039 recusa o DELETE na `journal`, e portanto recusa o
-- apagamento do titulo inteiro. E o comportamento certo: apagar um titulo cuja
-- baixa esta num mes ja entregue reescreveria esse mes em silencio. Quem
-- precisa mesmo de o fazer reabre o periodo, ou estorna pela tela de Limpeza.

-- ---------------------------------------------------------------------------
-- OS TRES SAO `AFTER DELETE`, E ISSO NAO E DETALHE
--
-- `ledger_settlements.journal_id` referencia `journal` com NO ACTION. Num
-- `BEFORE DELETE` a linha da baixa AINDA EXISTE, e apagar a partida esbarra na
-- propria chave estrangeira dela:
--
--   ERROR: update or delete on table "journal" violates foreign key constraint
--          "ledger_settlements_journal_id_fkey"
--
-- Apanhado a testar, e a transacao inteira ia abaixo — apagar o titulo passava
-- a ser impossivel. Depois do DELETE a linha ja nao esta la para segurar nada.
-- ---------------------------------------------------------------------------

-- ---------- a baixa leva a partida dela ----------
create or replace function baixa_leva_a_partida() returns trigger
language plpgsql as $$
begin
  -- Idempotente por natureza: o caminho da aplicacao ja apagou a partida antes
  -- de chegar aqui, e um delete que nao encontra nada e um no-op.
  if old.journal_id is not null then
    delete from journal where id = old.journal_id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_baixa_leva_a_partida on ledger_settlements;
create trigger trg_baixa_leva_a_partida
  after delete on ledger_settlements
  for each row execute function baixa_leva_a_partida();

-- ---------- o encargo leva a partida dele ----------
-- Aqui a ligacao nao e por coluna: `contabilizarEncargo` grava
-- `documentId: chargeId` com `sourceModule: 'charge'`. E a mesma pergunta que o
-- `jaContabilizado` faz.
create or replace function encargo_leva_a_partida() returns trigger
language plpgsql as $$
begin
  delete from journal
   where document_id = old.id and source_module = 'charge';
  return old;
end;
$$;

drop trigger if exists trg_encargo_leva_a_partida on ledger_charges;
create trigger trg_encargo_leva_a_partida
  after delete on ledger_charges
  for each row execute function encargo_leva_a_partida();

-- ---------- o titulo leva a partida PROPRIA ----------
-- So `manual` e `payroll`, e a razao e o dono do documento:
--
--   Num titulo de COMPRA ou VENDA, a partida e do documento, nao do titulo — o
--   `document_id` aponta a nota. Apagar o titulo nao pode levar o lancamento da
--   nota, que continua a existir e a ser verdade. Esse estado (documento com
--   partida e sem titulo) e a "meia-integracao", que a Verificacao ja acusa e
--   que se resolve com Devolver.
--
--   Num titulo MANUAL ou de FOLHA a partida e do proprio titulo: `document_id`
--   e o id dele. Sem isto ficava orfa — e ficava mesmo, porque
--   `removerTituloDeFolha` apaga a linha sem chamar `descontabilizarFolha`.
create or replace function titulo_leva_a_partida_propria() returns trigger
language plpgsql as $$
begin
  delete from journal
   where document_id = old.id and source_module in ('manual', 'payroll');
  return old;
end;
$$;

drop trigger if exists trg_titulo_leva_a_partida_propria on ledger_items;
create trigger trg_titulo_leva_a_partida_propria
  after delete on ledger_items
  for each row execute function titulo_leva_a_partida_propria();
