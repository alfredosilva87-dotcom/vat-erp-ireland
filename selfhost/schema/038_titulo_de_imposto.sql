-- O TITULO DE IMPOSTO passa a ser um TIPO PROPRIO de titulo.
--
-- ---------------------------------------------------------------------------
-- POR QUE UM TIPO, E NAO UM TITULO MANUAL COMO OS OUTROS
--
-- Pedido do Alfredo, e ele tem razao no ponto contabil: "a contabilizacao
-- seria apenas na baixa do titulo (...) a geracao do doc nao geraria
-- lancamento, seria apenas na baixa (...) o lancamento banco contra debito de
-- imposto a pagar".
--
-- Um titulo manual reconhece a despesa na CRIACAO (DR despesa / CR
-- fornecedores) porque a divida so passa a existir quando alguem a lanca. Com
-- imposto e ao contrario: a divida JA existe no razao antes de haver titulo
-- nenhum — cada venda ja creditou a conta de controlo de IVA, e o saldo dela
-- e o que se deve. Lancar outra vez na criacao duplicaria o passivo.
--
-- O titulo de imposto e, entao, so a VISTA FINANCEIRA de um saldo que ja esta
-- contabilizado: nasce sem partida, e o razao so se mexe na baixa, com
-- DR imposto a pagar / CR banco. Essa partida ja e a que `postSettlement`
-- escreve — ela usa a conta de controlo DO TITULO, e a conta de controlo
-- destes e a propria conta do imposto.
--
-- Sem este tipo, as duas coisas eram indistinguiveis na tabela, e a unica
-- forma de saber se um titulo devia ou nao ter partida era adivinhar pelo
-- codigo da conta — que e uma lista fixa que o escritorio nao pode mudar.
-- ---------------------------------------------------------------------------

alter table ledger_items drop constraint if exists ledger_items_source_module_check;
alter table ledger_items add constraint ledger_items_source_module_check
  check (source_module = any (array['purchase', 'sale', 'manual', 'payroll', 'tax']));

-- Os que ja nasceram pelo botao da apuracao, antes de existir o tipo.
--
-- O recorte e pela REFERENCIA e nao pela conta: a referencia e gerada por nos
-- (`VAT3 <periodo>`, `CT1 <periodo>`, ver lib/fiscal/tituloDeImposto.ts) e nao
-- ha como um titulo do escritorio se chamar assim por acaso. Recortar pela
-- conta apanharia um titulo manual legitimo lancado contra 845.
update ledger_items
   set source_module = 'tax'
 where source_module = 'manual'
   and (document_ref like 'VAT3 %' or document_ref like 'CT1 %');

comment on column ledger_items.source_module is
  'De onde o titulo veio. ''tax'' nasce SEM partida: o razao so se mexe na baixa. Ver selfhost/schema/038.';
