-- Quando o documento ENTROU no sistema, e o que a leitura disse que ele é.
--
-- `created_at` responde "quando a linha foi gravada", que é o momento em que o
-- contador clicou — não quando o documento chegou. Entre uma coisa e outra
-- passam-se dias: a foto do posto chega no sábado e é lançada na segunda. Para
-- perguntar "isto chegou antes do fechamento?" a data de gravação não serve.
alter table invoices add column if not exists captured_at timestamptz;
alter table sales    add column if not exists captured_at timestamptz;

-- A classificação da leitura (nota, recibo, planilha, ilegível, não-documento).
-- Guardada junto com a nota porque é o que explica, meses depois, por que uma
-- entrada foi conferida à mão ou por que um documento foi descartado.
alter table invoices add column if not exists doc_kind text;
alter table sales    add column if not exists doc_kind text;
