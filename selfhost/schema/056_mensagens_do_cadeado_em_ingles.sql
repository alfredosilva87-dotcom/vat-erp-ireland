-- AS MENSAGENS DO CADEADO PASSAM A INGLES.
--
-- ---------------------------------------------------------------------------
-- O QUE O UTILIZADOR VIA
--
-- A trava do periodo fechado e no BANCO, e nao no ecra — e essa e a parte boa,
-- porque e a unica que vale. Mas a mensagem que ela levanta sobe intacta ate a
-- tela, e o que o contabilista irlandes lia era:
--
--     Periodo fechado ate 2026-07-31. Para lancar ou mexer nesta data,
--     reabra o fechamento desse mes primeiro.
--
-- Portugues, e sem acentos. Num produto que se vende na Irlanda, uma mensagem
-- assim nao e so incomoda: e ilegivel para quem a recebe, exactamente no
-- momento em que ela e a unica coisa que explica porque o botao nao funcionou.
--
-- ---------------------------------------------------------------------------
-- SO A MENSAGEM MUDA
--
-- A regra, a saida da cascata e os gatilhos ficam como estao — sao codigo
-- provado, e o teste de ponta a ponta confirmou-os a funcionar (HTTP 409 ao
-- apagar dentro de um mes fechado, e recusa vinda do servidor, nao do ecra).
-- Isto substitui a funcao para trocar o texto, e mais nada.
--
-- Sem acentos de proposito: e uma string de excepcao do Postgres, e o encoding
-- desta mensagem atravessa camadas que nao controlamos.

create or replace function periodo_fechado_recusar(
  cli uuid, d_antiga date, d_nova date
) returns void
language plpgsql as $$
declare travada date;
begin
  if cli is null then return; end if;

  /*
   * O cliente a ser APAGADO nao pode ficar preso pelo proprio cadeado.
   *
   * `on delete cascade` manda as notas, os movimentos e as partidas abaixo, e
   * cada uma delas passa por aqui. Sem esta saida, apagar um cliente que tenha
   * um so mes fechado era impossivel — e a mensagem de erro falaria de um
   * fechamento, que ninguem ligaria a um cliente que se esta a apagar.
   */
  if not exists (select 1 from clients where id = cli) then return; end if;

  -- As DUAS datas contam: tirar um movimento de um mes fechado muda esse mes
  -- tanto como po-lo la.
  select p.period_end into travada
    from accounting_periods p
   where p.client_id = cli
     and p.reopened_at is null
     and (
       (d_antiga is not null and d_antiga between p.period_start and p.period_end)
       or (d_nova is not null and d_nova between p.period_start and p.period_end)
     )
   limit 1;

  if travada is not null then
    raise exception
      'This period is closed up to %. To post or change anything on this date, reopen that month first (Accounting > Period close).', travada
      using errcode = 'check_violation';
  end if;
end;
$$;
