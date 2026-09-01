-- A LIMPEZA DO RAZAO, e o registo que sobrevive a ela.
--
-- ---------------------------------------------------------------------------
-- O QUE FALTAVA
--
-- Pedido do Alfredo (2026-09-01): "precisamos fazer uma forma de ser possivel
-- excluir esses lancamentos, uma tela de exclusao etc".
--
-- O caso que o levou ali: conta 812 com razao 4.924,01 e titulos 4.958,21,
-- diferenca -34,20 e nada no ecra que a explicasse. Eram tres partidas — duas
-- baixas (13,00 e 24,00) e um encargo (2,80) — cujas linhas de origem tinham
-- sido levadas pela CASCATA do banco de dados quando o titulo foi apagado:
-- `ledger_settlements` e `ledger_charges` apontam a `ledger_items` com
-- ON DELETE CASCADE, e `journal` nao aponta a nada disso.
--
-- Sobrava movimento no razao que nada explicava, e nao havia por onde tira-lo:
-- o unico caminho era SQL a mao, que e precisamente o caminho que ninguem
-- audita.
--
-- ---------------------------------------------------------------------------
-- POR QUE UM REGISTO, E NAO SO UM DELETE
--
-- Porque "excluir" e "nao perder o rastro" foram pedidos na MESMA frase, e num
-- sistema contabil os dois sao legitimos ao mesmo tempo:
--
--   ESTORNAR e o que se faz a um facto que existiu e estava errado. A partida
--   original fica, e nasce a espelhada. Nada desaparece, e por isso e o unico
--   caminho possivel em periodo FECHADO.
--
--   APAGAR e o que se faz ao lixo — partida cuja origem ja nao existe, que
--   nunca devia ter ficado. Estornar lixo com lixo duplica as linhas a
--   explicar em vez de as reduzir.
--
-- O que esta tabela garante e que apagar tambem deixa rasto. Guarda o
-- lancamento INTEIRO em JSON antes de ele sair — cabecalho e linhas — para a
-- pergunta "o que e que estava aqui, e quem o tirou?" ter resposta depois de a
-- linha ja nao existir. Sem isto, apagar seria indefensavel numa auditoria; com
-- isto, e uma decisao registada.

create table if not exists journal_removals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,

  -- O id do lancamento que saiu. NAO e chave estrangeira de proposito: a linha
  -- que ele apontava deixou de existir, e uma FK obrigaria a apagar o registo
  -- junto — que e o oposto do que esta tabela existe para fazer.
  journal_id uuid not null,

  -- 'reverse' deixou as duas linhas a vista; 'delete' tirou o lancamento.
  action text not null check (action in ('reverse', 'delete')),

  -- Por que se detectou como removivel. Hoje: 'orphan' (a origem nao existe)
  -- ou 'manual' (alguem escolheu na tela).
  reason text not null,

  -- A nota de quem removeu. Obrigatoria na tela: um lancamento que sai do
  -- razao sem uma frase a dizer porque saiu volta a ser um misterio, so que
  -- desta vez sem sequer a partida para investigar.
  note text,

  -- O lancamento inteiro como estava — cabecalho e linhas. E a unica copia
  -- depois de um 'delete'.
  snapshot jsonb not null,

  -- Quando foi 'reverse', o lancamento espelhado que nasceu.
  reversal_journal_id uuid,

  removed_by uuid,
  removed_at timestamptz not null default now()
);

create index if not exists idx_journal_removals_client on journal_removals(client_id, removed_at desc);
create index if not exists idx_journal_removals_journal on journal_removals(journal_id);
