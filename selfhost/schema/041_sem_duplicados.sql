-- OBRIGACOES DUPLICADAS, e a corrida que as criou.
--
-- ---------------------------------------------------------------------------
-- O QUE O ALFREDO VIU
--
-- A tela de obrigacoes mostrava cada linha duas vezes — VAT3 Jan-Feb duas
-- vezes, RTD 2026 duas vezes — e nao era a tela: eram duas linhas de verdade
-- na tabela. Prova disso: ele marcou "Mark filed" nas duas, e os carimbos
-- ficaram a tres segundos um do outro.
--
-- ---------------------------------------------------------------------------
-- A CAUSA: LER-ENTAO-ESCREVER, SEM NADA A GUARDAR O MEIO
--
-- `getObligations` faz isto:
--
--   1. le as obrigacoes do ano; se ja houver, devolve
--   2. senao, calcula 14 apuracoes de IVA, uma consulta de cada vez
--   3. e insere as linhas
--
-- Entre o passo 1 e o 3 passa MUITO tempo — sao catorze idas ao banco. Dois
-- pedidos que cheguem nessa janela veem os dois a tabela vazia, e inserem os
-- dois. E basta abrir a tela duas vezes, ou a tela e a agenda ao mesmo tempo.
--
-- Nao havia nada a impedi-lo: a tabela so tinha um indice comum por
-- (client_id, year), que nao e unico.
--
-- O `getObligations` passou a inserir com `upsert` + `ignoreDuplicates`, mas o
-- que fecha mesmo a porta e o indice: qualquer caminho futuro — outra rota, o
-- self-host, um script — herda a garantia sem ter de se lembrar dela.
-- ---------------------------------------------------------------------------

-- 1. LIMPAR O QUE JA EXISTE -------------------------------------------------
--
-- Qual das duas sobrevive nao e indiferente: numa delas ele carregou em "Mark
-- filed". A entregue ganha, e entre duas entregues fica a PRIMEIRA — foi a que
-- ele quis marcar; a segunda foi o eco.
with ranked as (
  select id,
         row_number() over (
           partition by client_id, kind, period_start, period_end
           order by (status = 'filed') desc, filed_at asc nulls last, id
         ) as posicao
    from obligations
)
delete from obligations o
 using ranked r
 where o.id = r.id and r.posicao > 1;

-- 2. E FECHAR A PORTA -------------------------------------------------------

create unique index if not exists idx_obligations_unica
  on obligations(client_id, kind, period_start, period_end);

/*
 * O MESMO PADRAO existe noutros dois sitios, e la ainda nao mordeu.
 *
 * `existente()` em titles.ts e `jaContabilizado()` em service.ts sao o mesmo
 * ler-entao-escrever: procuram, nao acham, e criam. Ambos usam `maybeSingle`,
 * que REBENTA se encontrar duas — ou seja, uma duplicata ali nao daria uma tela
 * com linhas a dobrar, daria uma funcao a falhar sem explicacao a partir dai.
 *
 * A varredura de hoje nao encontrou nenhuma (0 grupos repetidos em invoices,
 * sales, ledger_items, journal, bank_transactions, chart_of_accounts e
 * ledger_settlements). Estes indices sao o que garante que continua assim.
 */
create unique index if not exists idx_ledger_items_um_por_documento
  on ledger_items(client_id, document_id)
  where document_id is not null;

/*
 * Uma partida por documento e por origem.
 *
 * ATENCAO ao unico caminho que poderia colidir de forma legitima: `settle()`
 * usa `documentId: bankTransactionId ?? ledgerItemId`. Hoje os dois chamadores
 * passam sempre a transacao bancaria, entao cada baixa tem chave propria. Se
 * um dia aparecer uma baixa SEM movimento de banco, a segunda baixa parcial do
 * mesmo titulo bate aqui — e falhar alto e melhor do que lancar duas vezes em
 * silencio, mas quem lá chegar precisa de saber porque.
 */
create unique index if not exists idx_journal_um_por_documento
  on journal(client_id, source_module, document_id)
  where document_id is not null;
