-- A DATA A PARTIR DA QUAL UM CLIENTE TEM OBRIGACOES.
--
-- ---------------------------------------------------------------------------
-- O QUE ACONTECIA SEM ISTO
--
-- Um cliente registado a 03/09/2026 abria o painel com TRES declaracoes
-- marcadas "Overdue" — VAT3 de Jan-Fev, Mar-Abr e Mai-Jun — de periodos em que
-- ele nao era cliente de ninguem. O cliente tinha 0,00 EUR em tudo.
--
-- Nao e um erro de calculo: o gerador de obrigacoes so sabia o ANO, entao
-- gerava o ano inteiro. Faltava-lhe a unica informacao que decide, que e
-- quando a empresa entrou na carteira do escritorio.
--
-- ---------------------------------------------------------------------------
-- PORQUE ISTO IMPORTA MAIS DO QUE PARECE
--
-- A agenda fiscal (`/obligations`) e a tela que o escritorio abre de manha, e
-- esta ordenada "pelo mais urgente". Cada cliente novo entrava la a VERMELHO,
-- no topo, a frente dos atrasos verdadeiros. Com uma carteira a crescer, o
-- alarme deixa de valer — que e o mecanismo classico de dessensibilizacao: o
-- vermelho que aparece sempre passa a nao ser lido nenhuma vez.
--
-- ---------------------------------------------------------------------------
-- PORQUE NASCE NULA, E NAO COM A DATA DE CRIACAO DO REGISTO
--
-- Preencher isto com `created_at` seria a tentacao obvia e estaria errado: o
-- escritorio cadastra hoje clientes que acompanha ha anos, e cortar-lhes o
-- historico esconderia atrasos REAIS. Nula mantem o comportamento de sempre —
-- o ano inteiro — e quem quiser o corte diz a data.
--
-- O corte e pelo FIM do periodo, nao pelo prazo: ver lib/fiscal/calendario.ts.

alter table clients
  add column if not exists obligations_from date;

comment on column clients.obligations_from is
  'Data de entrada na carteira / registo em VAT. Obrigacoes cujo periodo acabou antes desta data nao sao geradas. Nula = gerar o ano inteiro (comportamento anterior).';
