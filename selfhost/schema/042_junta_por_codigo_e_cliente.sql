-- O BALANCETE JUNTAVA SO PELO CODIGO DA CONTA. UMA CONTA REPETIDA CONTAVA A DOBRAR.
--
-- ---------------------------------------------------------------------------
-- O RISCO, QUE AINDA NAO ACONTECEU
--
-- `account_balances` e `trial_balance` juntavam assim:
--
--   journal_lines l LEFT JOIN chart_of_accounts c ON c.code = l.account_code
--
-- Sem o cliente na condicao. E o plano tem DOIS espacos de codigos, com dois
-- indices unicos parciais que os deixam coexistir de proposito:
--
--   idx_coa_shared_code   (code)              where client_id is null
--   idx_coa_client_code   (client_id, code)   where client_id is not null
--
-- Ou seja, o codigo '112' pode existir no plano do escritorio E no plano
-- proprio de um cliente. Quando isso acontece, cada linha de razao daquele
-- codigo casa com DUAS linhas do plano, e a juncao devolve a linha duas vezes:
-- todo o debito e todo o credito daquela conta passam a contar em dobro no
-- balancete, no DRE e no balanco.
--
-- Medido de verdade, plantando a colisao no Kilkenny: o balancete passava de
-- 88.805,04 / 88.805,04 para 90.645,04 / 88.805,04 — 1.840,00 a mais de um
-- lado so, que e o movimento daquela conta contado duas vezes.
--
-- O balanco deixa de fechar, entao HA alarme. Mas o alarme aponta para o sitio
-- errado: manda procurar um lancamento desequilibrado no razao, e o razao esta
-- perfeito — a diferenca nasce na juncao, que nao aparece em ecra nenhum.
-- Podiam-se procurar partidas durante um dia inteiro sem achar nada.
--
-- Hoje nao ha colisao nenhuma (verificado), e `createAccount` ajuda sem saber:
-- obriga a conta propria de cliente a ficar na faixa 9000-9899. Mas
-- `bulkImportAccounts` — a importacao do plano antigo por planilha — nao tinha
-- essa trava, e e por ali que um '112' de cliente entraria.
--
-- ---------------------------------------------------------------------------
-- A CORRECAO: UMA LINHA DE PLANO POR LINHA DE RAZAO, E A DO CLIENTE GANHA
--
-- O `lateral ... limit 1` faz duas coisas de uma vez: garante no maximo uma
-- correspondencia (fim da duplicacao, aconteca o que acontecer ao plano), e
-- resolve o empate a favor da conta PROPRIA do cliente, que e a resposta certa
-- — se o cliente definiu aquele codigo, e a descricao dele que descreve o
-- lancamento dele.
-- ---------------------------------------------------------------------------

create or replace view account_balances as
  select j.client_id,
         l.account_code,
         coalesce(c.description, l.account_code) as account_name,
         c.type,
         c.report_group,
         j.posting_date,
         sum(l.debit) as debit,
         sum(l.credit) as credit,
         sum(case when c.type = any (array['asset','expense']) then l.debit - l.credit
                  else l.credit - l.debit end) as balance
    from journal_lines l
    join journal j on j.id = l.journal_id
    left join lateral (
      select co.description, co.type, co.report_group
        from chart_of_accounts co
       where co.code = l.account_code
         and co.type is not null
         and (co.client_id = j.client_id or co.client_id is null)
       order by (co.client_id is not null) desc
       limit 1
    ) c on true
   group by j.client_id, l.account_code, c.description, c.type, c.report_group, j.posting_date;

create or replace view trial_balance as
  select j.client_id,
         j.posting_date,
         l.account_code,
         coalesce(c.description, l.account_code) as account_name,
         c.type,
         c.report_group,
         l.debit,
         l.credit,
         case when c.type = any (array['asset','expense']) then l.debit - l.credit
              else l.credit - l.debit end as balance,
         j.source_module,
         j.document_id,
         j.id as journal_id
    from journal_lines l
    join journal j on j.id = l.journal_id
    left join lateral (
      select co.description, co.type, co.report_group
        from chart_of_accounts co
       where co.code = l.account_code
         and co.type is not null
         and (co.client_id = j.client_id or co.client_id is null)
       order by (co.client_id is not null) desc
       limit 1
    ) c on true;

comment on view account_balances is
  'Saldos por conta e data. A juncao ao plano e por codigo E cliente, com no maximo uma linha — ver selfhost/schema/042.';
