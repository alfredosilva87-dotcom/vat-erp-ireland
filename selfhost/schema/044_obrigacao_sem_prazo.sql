-- UMA OBRIGACAO PODE NASCER SEM PRAZO, e a coluna nao deixava.
--
-- ---------------------------------------------------------------------------
-- O QUE ISTO DESTRAVA
--
-- O calendario da agenda (043) grava CT1, B1, Form 11 e o pagamento por conta
-- a partir da forma juridica. Dois desses prazos dependem de um dado que o
-- sistema NAO deduz: o fecho do exercicio e a Annual Return Date do CRO.
--
-- Quando falta, a obrigacao nasce SEM vencimento e a dizer qual campo falta —
-- e `classificar` em lib/fiscal/agenda.ts pinta de amarelo o que nao tem
-- prazo, precisamente porque e cadastro por completar. Uma data inventada
-- ficaria verde e nunca mais seria olhada.
--
-- So que `due_date` era `not null`. O insert falhava, e como o codigo nao
-- verificava o erro da gravacao, a tela continuava a mostrar so o IVA: sem
-- erro, sem aviso, sem nada. Cheguei a desconfiar do deploy por causa disto.
-- Ambos corrigidos — a coluna aqui, o erro mudo em `getObligations`.
--
-- As que ja existem tem todas prazo; nada muda para elas.
-- ---------------------------------------------------------------------------

alter table obligations alter column due_date drop not null;

comment on column obligations.due_date is
  'Nulo quando o cadastro ainda nao permite saber o prazo (CT1 sem fecho do exercicio, B1 sem a data da anual). Ver lib/fiscal/calendario.ts.';
