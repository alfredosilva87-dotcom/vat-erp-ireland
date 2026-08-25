-- A trava de baixa passa a contar os ENCARGOS.
--
-- Ela comparava a soma das baixas com `original_amount` e mais nada. Enquanto
-- o título valia só o que estava no documento, isso bastava. Desde que existem
-- encargos (migração 026), um título de €479,58 com €10 de juro deve €489,58 —
-- e pagar os €489,58 batia na trava com "excede o título".
--
-- O sintoma é cruel: o sistema recusa a baixa do valor que ele próprio mostra
-- como em aberto, sem dizer que o problema é o juro. Quem está na tela conclui
-- que o número está errado.
--
-- Desconto abate, como em toda a parte: o sinal vem do `kind`.
create or replace function ledger_conferir_baixa() returns trigger
language plpgsql as $$
declare
  v_devido  numeric(14,2);
  v_baixado numeric(14,2);
begin
  select i.original_amount + coalesce((
           select sum(case when c.kind = 'discount' then -c.amount else c.amount end)
             from ledger_charges c where c.ledger_item_id = i.id
         ), 0)
    into v_devido
    from ledger_items i where i.id = new.ledger_item_id;

  select coalesce(sum(amount), 0) into v_baixado
    from ledger_settlements where ledger_item_id = new.ledger_item_id;

  -- Meio cêntimo de folga: somas de encargos e baixas com casas diferentes não
  -- podem recusar uma baixa exata por erro de arredondamento.
  if v_baixado > v_devido + 0.005 then
    raise exception 'Baixa de % excede o titulo (devido %, ja baixado %).',
      new.amount, v_devido, v_baixado - new.amount;
  end if;
  return null;
end $$;
