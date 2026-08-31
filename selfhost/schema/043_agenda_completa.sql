-- A AGENDA FISCAL PASSA A TER O IMPOSTO E AS CONTAS ANUAIS.
--
-- ---------------------------------------------------------------------------
-- O QUE FALTAVA
--
-- `obligation_kind` so conhecia VAT3 e RTD, entao a agenda mostrava o IVA e
-- mais nada. O imposto sobre o lucro e a publicacao das contas no CRO — as
-- duas com coima por atraso — nao tinham data em sitio nenhum.
--
-- A lista do que cada forma juridica deve ja existia em lib/fiscal/
-- formaJuridica.ts, mas era descritiva: ninguem gerava as linhas.
--
-- ---------------------------------------------------------------------------
-- OS DOIS CAMPOS NOVOS DO CADASTRO, E POR QUE SAO PRECISOS
--
-- `financial_year_end` — o CT1 vence nove meses depois do FECHO DO EXERCICIO,
-- e nem toda a empresa fecha em Dezembro. Guarda-se `MM-DD` e nao uma data
-- completa porque o fecho repete-se todos os anos; com o ano dentro, alguem
-- teria de editar o cadastro cada Janeiro.
--
-- `annual_return_date` — a B1 conta 56 dias a partir da Annual Return Date, e
-- essa data NAO sai do calendario fiscal: vem da constituicao da empresa e
-- esta na ficha do CRO. E o unico prazo aqui que o sistema nao consegue
-- deduzir de mais nada.
--
-- Sem eles, a obrigacao nasce SEM VENCIMENTO em vez de nascer com um palpite —
-- e `classificar` em agenda.ts pinta de amarelo o que nao tem prazo,
-- precisamente porque e cadastro por completar. Uma data inventada ficava
-- verde e nunca mais era olhada.
-- ---------------------------------------------------------------------------

alter type obligation_kind add value if not exists 'CT1';
alter type obligation_kind add value if not exists 'B1';
alter type obligation_kind add value if not exists 'FORM11';
alter type obligation_kind add value if not exists 'PRELIMINARY_TAX';

alter table clients add column if not exists financial_year_end text;
alter table clients add column if not exists annual_return_date date;

comment on column clients.financial_year_end is
  'Fecho do exercicio em MM-DD. Define o periodo e o prazo do CT1. Ver lib/fiscal/calendario.ts.';
comment on column clients.annual_return_date is
  'Annual Return Date do CRO. A B1 vence 56 dias depois dela; repete-se todos os anos no mesmo dia.';
