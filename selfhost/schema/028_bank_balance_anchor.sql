-- O saldo do banco deixa de ser recalculado desde o princípio dos tempos.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTAVA ERRADO
--
-- `bank_account_balances` somava `saldo de abertura + TODAS as transações`, a
-- cada leitura, para TODAS as contas — sem cláusula nenhuma que limitasse.
-- Como a agregação era sobre a tabela inteira, o Postgres varria tudo mesmo
-- havendo índice: com 1.048 transações demorava 44 ms, e o custo cresce
-- linearmente para sempre. Um cliente com cinco anos de extrato pagaria essa
-- conta em cada abertura de tela.
--
-- E há a leitura humana: o Alfredo pediu "um saldo anterior do mês para não
-- ficar recalculando sempre". É também como se lê um extrato — saldo anterior,
-- movimento do período, saldo atual.
--
-- ---------------------------------------------------------------------------
-- A ÂNCORA
--
-- `bank_closings` já guardava o fecho por período e nunca foi usada. Agora é
-- ela o ponto de partida: o saldo é `fecho travado mais recente + o que veio
-- depois dele`. Só fechos TRAVADOS (`locked`) servem de âncora — um fecho em
-- rascunho ainda pode mudar, e ancorar num número que muda daria um saldo que
-- se altera sozinho sem nenhuma transação nova.
--
-- Sem fecho nenhum, o comportamento é o de antes: abertura + tudo. Nenhuma
-- instalação precisa de fazer nada para continuar a funcionar.
--
-- Os `lateral` são o que faz o índice servir: a soma passa a ser por conta E
-- por data (`idx_bank_txn_account`), em vez de uma agregação global.
--
-- O `coalesce(period_end, '-infinity')` não é elegância: escrito como
-- `(period_end is null or data > period_end)` o Postgres NÃO usa o índice — o
-- `OR` fecha essa porta — e a vista ficava mais lenta do que a que substituiu
-- (116 ms contra 44 ms, medido). Com a comparação simples, o mesmo predicado
-- percorre o índice.
--
-- Os totais NÃO CONCILIADOS continuam a olhar todo o histórico, de propósito:
-- uma linha por conciliar de antes do fecho continua por conciliar, e escondê-la
-- seria apagar exatamente a anomalia que se quer ver. Esses usam os índices
-- parciais que já existiam (`idx_bank_txn_open`, `idx_stmt_lines_pending`).
-- ---------------------------------------------------------------------------
drop view if exists bank_account_balances;

create view bank_account_balances as
with ancora as (
  select distinct on (bank_account_id)
         bank_account_id, period_end, system_balance, statement_balance
    from bank_closings
   where locked
   order by bank_account_id, period_end desc
)
select
  a.id as bank_account_id,
  a.client_id,
  a.name,
  a.currency,
  a.opening_balance,

  -- De onde parte a conta, e com que valor. A tela mostra isto como
  -- "saldo anterior", que é como um extrato se lê.
  an.period_end                                        as anchor_date,
  coalesce(an.system_balance, a.opening_balance)       as anchor_balance,
  coalesce(an.statement_balance, a.opening_balance)    as anchor_statement_balance,

  coalesce(an.statement_balance, a.opening_balance) + coalesce(s.total, 0) as statement_balance,
  coalesce(an.system_balance, a.opening_balance) + coalesce(t.total, 0)    as system_balance,

  -- O movimento desde a âncora, separado: é o "do período" do extrato.
  coalesce(t.total, 0) as movement_since_anchor,
  coalesce(t.cnt, 0)   as movement_count_since_anchor,

  coalesce(su.total, 0) as unreconciled_statement_total,
  coalesce(su.cnt, 0)   as unreconciled_statement_count,
  coalesce(tu.total, 0) as outstanding_transaction_total,
  coalesce(tu.cnt, 0)   as outstanding_transaction_count
from bank_accounts a
left join ancora an on an.bank_account_id = a.id
left join lateral (
  select sum(l.amount) as total
    from bank_statement_lines l
   where l.bank_account_id = a.id
     and l.line_date > coalesce(an.period_end, '-infinity'::date)
) s on true
left join lateral (
  select sum(x.amount) as total, count(*) as cnt
    from bank_transactions x
   where x.bank_account_id = a.id
     and x.txn_date > coalesce(an.period_end, '-infinity'::date)
) t on true
left join lateral (
  select sum(l.amount) as total, count(*) as cnt
    from bank_statement_lines l
   where l.bank_account_id = a.id and l.status = 'unreconciled'
) su on true
left join lateral (
  select sum(x.amount) as total, count(*) as cnt
    from bank_transactions x
   where x.bank_account_id = a.id and x.statement_line_id is null
) tu on true;
