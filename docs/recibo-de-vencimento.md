# O recibo de vencimento — o que ele mostra e porquê

> Material para a documentação do ERP. Estado em **2026-09-03** (v1.50).

O payslip é o único papel do sistema que vai para a mão de quem trabalha. Um
relatório interno mal formatado irrita o escritório; um recibo mal feito faz a
pessoa duvidar do que lhe pagaram — e ela tem direito legal a recebê-lo
(*Payment of Wages Act 1991*: declaração escrita do bruto e de cada dedução, em
cada pagamento).

## Formato

**Meia folha A4** — 595 × 421 pt, exactamente metade, com a mesma largura. A
largura igual é o que permite manter as três colunas onde estão: o corte é só na
altura. Uma A4 inteira por pessoa é papel a mais para quem imprime trinta por
semana; duas metades cortam-se ao meio e entregam-se.

**Uma pessoa por página, sempre**, mesmo ao imprimir a empresa inteira num
ficheiro só. Recibos de duas pessoas na mesma folha acabam entregues à pessoa
errada — e o que lá está é o salário de alguém.

## Estrutura

Copiada de um payslip do Sage real, e não por gosto: quem confere um recibo
destes já o fez mil vezes noutro sistema e procura cada número no sítio onde ele
sempre esteve. Um recibo que não se reconhece leva-se de volta ao balcão.

```
┌──────────────────────────────────────────────────────────────┐
│ Empregador · reg. comercial              PAYSLIP · Semana N  │
├──────────────────────────────────────────────────────────────┤
│ NOME · FREQUÊNCIA · PPS                                      │
│ N.º FUNCIONÁRIO · FUNÇÃO · PERÍODO · DATA DE PAGAMENTO       │
├───────────────────┬────────────────────┬─────────────────────┤
│ PAGAMENTOS        │ DESCONTOS          │ RESUMO              │
│ desc │ h │ taxa   │ desc │ período │ acum │  bruto           │
│                   │ PAYE / PRSI / USC  │  descontos         │
│                   │ — contrib. patrão  │  LÍQUIDO           │
│ Bruto             │ Total de descontos │                    │
├───────────────────┴────────────────────┴─────────────────────┤
│ ACUMULADO      │ DADOS FISCAIS       │ CUSTO DO EMPREGADOR   │
└──────────────────────────────────────────────────────────────┘
```

### Decisões que valem a pena manter

**Os descontos têm duas colunas de valor — período e acumulado.** Assim
`PAYE 53,84 / 1.755,70` lê-se de uma vez. Com o acumulado numa tabela à parte no
fundo, quem confere tem de saltar de um sítio para o outro guardando o número de
cabeça — que é exactamente o que um recibo existe para evitar.

**A contribuição do empregador está no bloco dos descontos, com uma linha a
dizer o que é.** Sem esse aviso, um segundo `AE Pension 9,81` logo abaixo do
primeiro lê-se como descontado a dobrar, e é a primeira coisa que alguém traz de
volta ao balcão.

**O cut-off e o crédito aparecem do período *e* acumulados.** O crédito semanal
é o número que a pessoa reconhece e por onde confere; o acumulado de milhares na
semana 35 não se compara com nada.

**As férias gozadas saem com valor zero.** O tempo já foi pago no bruto da
semana em que foi gozado; somá-lo pagaria duas vezes. Vai como informação porque
a pessoa quer ver o saldo mexer.

**As linhas têm de fechar com o bruto.** O bruto vem do motor, que sabe de
valor lançado à mão, de contrato fixo rateado e de arredondamento; a
decomposição em linhas é apresentação, e apresentação não pode contradizer o
número. O que sobrar sai numa linha própria em vez de desaparecer.

## A única coisa configurável: as horas

`hr_client.payslip_show_hours`, por empresa. É o que o próprio Sage faz — a
coluna existe sempre e vem vazia para quem é salariado. Uma casa toda de
salariados não quer uma coluna vazia em todos os recibos; uma de horistas quer
as horas à vista. Tudo o resto é igual para toda a gente, de propósito.

## Rascunho e fechado

O recibo **fechado lê-se do que foi gravado e não se recalcula**. Reimprimir a
semana 12 em Dezembro tem de dar o mesmo papel que saiu em Março — e daria outro
se recalculasse, porque a tabela fiscal pode ter sido corrigida entretanto. É a
pior espécie de falha, por ser silenciosa: os dois papéis parecem bons, e só
quem tiver os dois à frente é que vê.

O que ainda não fechou sai com a **tarja DRAFT** atravessada, desenhada por cima
de tudo. Ficou por baixo das faixas na primeira versão e saía aos pedaços — uma
tarja que se vê mal é pior do que nenhuma, porque dá a ideia de que o documento
está marcado quando não está.

Os avisos (sem PPS, tabela por confirmar, buraco no acumulado) só saem no
rascunho: são para quem confere antes de fechar. Num recibo já entregue seriam
ruído sobre coisas que já não estão em aberto.

## Acentos

O `ascii()` de `lib/accounting/pdfKit.ts` atirava fora tudo o que não fosse ASCII
**com a letra junto**: "José" saía "Jos". O WinAnsi escreve o latim acentuado
inteiro; só o que está fora do cp1252 (ł polaco, ș romeno) perde o acento. O
defeito valia para todos os PDFs do sistema e passava despercebido porque
ninguém confere o nome de um cliente num relatório interno. Num recibo semanal,
confere.

## Ficheiros

| Ficheiro | O que faz |
|---|---|
| `lib/hr/payslipPuro.ts` | decomposição do bruto em linhas, nome do ficheiro — testável sozinho |
| `lib/hr/payslip.ts` | monta o recibo a partir do que está gravado |
| `lib/hr/payslipPdf.ts` | desenha |
| `lib/i18nServer.ts` | traduz no servidor: um PDF nasce pronto em bytes |
| `app/api/hr/companies/[id]/payslips/route.ts` | a rota |
| `tests/payslip.test.js` | prova que as linhas fecham com o bruto |
