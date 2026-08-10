# Plano de execução — conciliação bancária e ingestão de documentos

> Criado em 2026-08-09. **Este arquivo é a fonte da verdade entre sessões.**
> Ao retomar em sessão nova: leia este arquivo, veja qual camada está aberta,
> continue dali. Não é preciso ter o histórico do chat.
>
> Pesquisa que sustenta as decisões: [pesquisa-xero.md](pesquisa-xero.md) e
> [pesquisa-dext.md](pesquisa-dext.md).

## Decisão fundadora

Pedido do cliente do escritório. Usuário escolheu **construir equivalente
dentro do sistema**, não integrar: conciliação bancária no estilo Xero e
ingestão no estilo Dext, rodando no servidor local, **dado nenhum sai**.

A pesquisa confirmou que essa era a **única opção viável**, por dois motivos
independentes:

- **Dext não tem API pública.** Pedido oficial "Under Review" desde 2021.
- **Xero declara que conciliação via API está permanentemente fora de escopo**,
  e dados de extrato não conciliados não são expostos.

## A vantagem que a pesquisa revelou

O Xero **não tem edição irlandesa**. Não traz as alíquotas irlandesas, não gera
VAT3, não transmite ao ROS — terceiriza isso para um plugin. E a base irlandesa
**"Monies Received"** (vendas por competência, compras por caixa) não é
suportada nativamente.

O VAT ERP já é irlandês de nascença. Ao ganhar conciliação bancária, passa a
cobrir um terreno que o Xero cobre mal na Irlanda. Vale registrar isso na
conversa com o escritório.

---

## Estado atual do sistema (verificado em 2026-08-09)

### O que já existe e será reaproveitado

| Ativo | Onde | Uso no plano |
|---|---|---|
| Motor de casamento por força de sinal | `lib/duplicates.ts` | Base do casamento extrato ↔ nota |
| Leitura de Excel/CSV/TXT com detecção de coluna | `app/clients/[id]/sales/page.tsx` (`parseRows`) | Precisa sair para `lib/` e generalizar |
| Extração de PDF/imagem com score e revisão | `lib/extractor/` | Extrato em PDF, camada A5 |
| Aprendizado por correção | `items_master`, `client_item_accounts` | Camada 3 do motor de sugestão |
| Plano de contas por cliente | `chart_of_accounts` | Destino contábil das linhas |
| Multi-empresa e perfis | `companies`, `app_users` | Já cobre o acesso |

### O buraco central

**O sistema conhece documentos, mas não conhece dinheiro.** Verificado no
schema: não existe conta bancária, não existe transação, e a nota **não tem
sequer status de paga ou em aberto**.

Conciliação é, na essência, ligar movimento de dinheiro a documento. Modelar
dinheiro é pré-requisito de tudo — é a Camada A0.

Consequência boa: assim que a nota souber se foi paga, vêm de brinde contas a
pagar em aberto, aging de fornecedor, e a checagem de que o VAT declarado bate
com o que saiu do banco.

---

## Princípios de execução

1. **Cada camada entrega algo testável sozinho.** Nada de três meses sem nada
   para mostrar ao cliente.
2. **Cada camada termina com o teste marcado neste arquivo.** É assim que a
   sessão seguinte sabe onde parar.
3. **Uma tag de versão por camada**, seguindo a convenção do projeto.
4. **Nunca copiar UI, marca ou texto** do Xero ou do Dext. Só a mecânica.
5. **Nada de credencial de terceiro.** O Dext guarda senha de portal de
   fornecedor para buscar faturas; **não vamos fazer isso** — é passivo de
   segurança incompatível com o motivo do self-host.

---

# FASE A — Conciliação bancária

## Camada A0 — Modelar dinheiro `[x] CONCLUÍDA (2026-08-10, v1.19)`

Entregue em `selfhost/schema/004_bank_reconciliation.sql`.

Tabelas: `bank_accounts`, `bank_imports`, `bank_statement_lines`,
`bank_transactions`, `bank_rules` (modelo pronto, interface na A3).
Views: `bank_account_balances` (os dois saldos) e `invoice_payment_status`.

Decisões tomadas na implementação:
- **Valor sempre com sinal único** nas linhas do extrato. Extrato com débito e
  crédito em colunas separadas é convertido na importação, para que o resto do
  sistema só lide com uma forma.
- **Situação de pagamento é view, não coluna.** Um campo `paid` mantido à mão
  diverge dos movimentos no primeiro estorno, e aí o número deixa de ser
  confiável justamente quando mais importa.
- **Tolerância de um cêntimo** no status de pago, senão arredondamento deixa
  nota eternamente "quase paga".
- `dedupe_key` é única **por conta bancária**, não global — a mesma linha pode
  legitimamente existir em duas contas.
- Coluna `reason` registra por que o sistema decidiu (`match`, `rule`,
  `memory`, `prediction`, `manual`), como o Xero faz.
- Migrações passaram a ser **descobertas por arquivo**, não listadas em código:
  basta adicionar `00N_*.sql`. Papel diferente declara-se no cabeçalho com
  `-- @role:`. Instalação existente recebe o novo schema ao re-rodar o
  instalador.

Verificado contra o banco:
- [x] Aplicar e **reaplicar** sem erro (idempotente)
- [x] Só extrato lançado → saldos divergem (877 vs 1000), 1 linha pendente
- [x] Após conciliar → diferença **zero**, nota vira **paga**
- [x] Reimportar a mesma linha → recusada; mesma chave em outra conta → aceita
- [x] Pagamento parcial → nota fica `partial` com saldo devedor correto
- [x] Movimento sem vínculo → aparece como pagamento em aberto
- [x] Trava de "uma nota **ou** uma venda, nunca as duas" → banco recusa

---

## Camada A0 — histórico do desenho `[referência]`

Sem tela. É a fundação.

**Entrega**
- `bank_accounts` por cliente: banco, nome, número, moeda, saldo inicial e data
- `bank_statement_lines`: conta, data, descrição, referência, valor com sinal,
  saldo, origem do arquivo, hash da linha, status de conciliação — **imutáveis**
- `payments`: liga dinheiro a documento (nota ou venda), com valor e data
- `invoices` ganha status derivado: em aberto, parcial, paga
- **Dois saldos calculados**, como no Xero: saldo do extrato (soma das linhas) e
  saldo no sistema (soma das transações). Conciliar **não altera nenhum dos dois**

**Por que assim:** é o modelo de duas séries do Xero. Um atalho aqui — só marcar
a nota como paga — destrói a capacidade de provar que o mês fecha, que é o
motivo de existir da conciliação.

**Testável quando:** dá para criar conta bancária, inserir linha na mão e ver os
dois saldos divergirem corretamente.

---

## Camada A1 — Importar extrato (CSV e Excel) `[x] CONCLUÍDA (2026-08-10, v1.20)`

**Parte 1 — o leitor (v1.19.1):** `lib/bankStatement.ts`, com 72 testes.

**Parte 2 — interface e gravação (v1.20):** contas bancárias, importação com
pré-visualização e ajuste de mapeamento, gravação com anti-duplicata, e desfazer
lote. 92 testes no total (`npm test`).

Entregue:

| O quê | Onde |
|---|---|
| Leitura de arquivo em grade de células (Excel/CSV, aspas respeitadas) | `lib/sheet.ts` |
| Acesso a dados de banco (contas, lotes, linhas) | `lib/bankStore.ts` |
| Rotas de conta, importação e desfazer | `app/api/clients/[id]/bank-accounts/` |
| Tela de contas com os dois saldos | `app/clients/[id]/bank/page.tsx` |
| Tela da conta: importar, linhas, histórico | `app/clients/[id]/bank/[accountId]/page.tsx` |
| Pré-visualização com editor de mapeamento | `components/StatementImport.tsx` |
| Mapeamento guardado por conta | `selfhost/schema/005_bank_statement_mapping.sql` |

Decisões tomadas na implementação:
- **O anti-duplicata é do banco de dados, não do código.** O índice único mais
  `on conflict do nothing` é o que garante que duas pessoas importando o mesmo
  arquivo ao mesmo tempo não dupliquem nada. O que o código faz é *contar* o que
  entrou. Filtrar em JavaScript antes de gravar pareceria funcionar e falharia
  exatamente no dia em que duas pessoas fecham o mês juntas.
- **"Quantas são novas?" é respondido antes de gravar** (`dryRun`), com o período
  que está repetindo. Saber depois não ajuda: a pessoa já não sabe se as 12
  ignoradas eram esperadas ou se ela pegou o arquivo da conta errada.
- **O mapeamento salvo é usado, mas conferido.** Se o banco mudar o layout, as
  colunas salvas passariam a apontar para o lugar errado e a importação daria
  certo com números errados — o pior tipo de defeito. Quando o mapeamento salvo
  não explica mais o arquivo, cai na detecção automática.
- **Importação 100% duplicada não deixa lote registrado.** Não é um evento, é a
  pessoa reabrindo um arquivo que já tinha carregado.
- **Desfazer não é só de administrador**, porque é a correção imediata do
  próprio erro; mas é recusado se qualquer linha do lote já foi conciliada,
  que é o caso em que sumiria informação de verdade.
- **`parseRows` da tela de vendas saiu para `lib/sheet.ts`** só na parte que era
  genuinamente comum (arquivo → células). O significado das colunas continua em
  cada tela, porque é aí que elas diferem. De brinde, CSV com vírgula dentro de
  aspas (`"TESCO STORES, DUBLIN"`) parou de empurrar as colunas de lado.

Verificado contra o banco (Postgres local, em transação desfeita ao fim):
- [x] 3 linhas importadas; reimportar janeiro+fevereiro entra **só a de fevereiro**
- [x] Total continua 4 linhas, não 7
- [x] Mesma chave em **outra conta** é aceita
- [x] Só extrato lançado → os dois saldos divergem pela soma das linhas
- [x] Desfazer lote sem conciliação remove exatamente as linhas dele
- [x] Lote com linha conciliada é detectado e recusado

Verificado **na tela**, ponta a ponta (2026-08-10, instância local):
- [x] Criar cliente → conta bancária → os dois saldos nascem iguais ao inicial
- [x] Extrato AIB com 4 linhas de preâmbulo: cabeçalho achado na **linha 5**,
      débito/crédito reconhecidos, `"TESCO STORES, DUBLIN"` inteiro apesar da
      vírgula, linha TOTAL contada à parte, **dois cafés iguais sobreviveram**
- [x] Gravar 7 linhas → saldo do extrato €4.557,70 (= o do próprio arquivo),
      saldo no sistema €1.000,00, diferença €3.557,70
- [x] Reimportar "janeiro e fevereiro": **2 novas · 7 já importadas
      (2026-01-02 a 2026-01-28)** anunciado *antes* de gravar; grava 2, total 9
- [x] Desfazer o segundo lote → 2 removidas, janeiro intacto, saldo volta
- [x] **Segundo banco** (ponto e vírgula, cabeçalho em português, `1.234,56`)
      detectado sozinho, sem tocar em código e sem reusar o mapa do AIB
- [x] Desfazer com uma linha já conciliada → **recusado**, nada removido

Nenhum formato de banco está embutido no código. O leitor detecta um ponto de
partida e o mapeamento fica **guardado como dado** por conta bancária — banco
novo é uma tela de confirmação, nunca programação.

Cobre hoje, verificado: colunas separadas de entrada/saída; coluna única com
sinal; vírgula decimal europeia e ponto de milhar; parênteses para negativo;
marcadores DR/CR; símbolo de moeda; preâmbulo antes do cabeçalho; arquivo sem
cabeçalho nenhum; datas em dia/mês, mês/dia, ISO e "31-Jan-2026"; e linhas de
totalização, que são contadas à parte em vez de reportadas como defeito.

Decisões que valem registro:
- **Contador de ocorrência na chave de duplicata.** Dois cafés iguais de €4,50
  no mesmo dia **não** são duplicata. Chavear só por data+valor+descrição
  engoliria o segundo em silêncio. Contando ocorrências dentro do arquivo, a
  repetição legítima sobrevive e a reimportação continua sendo recusada, porque
  o mesmo arquivo produz sempre a mesma sequência.
- **Conferência contra o saldo do próprio extrato.** Se o arquivo traz saldo,
  o leitor confere se a soma dos valores bate. Pega sinal invertido ou coluna
  errada na hora da importação — não no fechamento do mês.
- O estilo de data é decidido **sobre o arquivo inteiro**, não linha a linha:
  um único 31/01 em qualquer lugar resolve a ambiguidade de 03/04.

**O que ainda não foi feito com arquivo de verdade:** todos os formatos testados
são sintéticos — nenhum extrato real de cliente chegou até agora. A primeira
coisa a fazer quando chegarem é acrescentar cada arquivo como mais um caso em
`tests/bankStatement.test.js`. O objetivo é nunca corrigir um banco e quebrar
outro.

### Desenho original da camada

**Entrega**
- Tela de contas bancárias por cliente (criar, editar, listar)
- Importar arquivo para **uma conta específica**, um extrato por arquivo
- **Mapeamento de colunas guardado por conta bancária.** Bancos diferentes,
  formatos diferentes — pergunta uma vez, reusa sempre. Sem isso, cada cliente
  novo vira trabalho de programação e não escala
- Suporte a extrato com **débito/crédito em colunas separadas** e com valor
  único assinado
- **Anti-duplicata na importação**: reimportar período sobreposto não pode
  duplicar linha. Chave por data + valor + descrição + saldo
- Extrair `parseRows` da tela de vendas para `lib/` e generalizar

**Por que assim:** o contador vai baixar "janeiro", depois "janeiro e
fevereiro". Sem anti-duplicata, metade entra de novo e infla tudo em silêncio.

**Testável quando:**
- [x] Importa extrato → linhas aparecem com saldo correndo *(formatos sintéticos;
      falta repetir com arquivo real de banco)*
- [x] Importa o mesmo arquivo de novo → zero linhas duplicadas
- [x] Importa extrato de **outro banco**, com formato diferente → mapeia uma vez
- [x] Segunda importação daquele banco → automática (mapeamento salvo na conta)

---

## Camada A2 — Conciliar com sugestão de casamento `[x] CONCLUÍDA (2026-08-10, v1.21)`

O coração. Equivale à Camada 1 do motor do Xero.

Entregue:

| O quê | Onde |
|---|---|
| Motor de sugestão (função pura, 23 testes) | `lib/bankMatch.ts` |
| Conciliar, desconciliar, refazer, religar | `lib/bankReconcile.ts` |
| Rotas de sugestão e de ação por linha | `app/api/clients/[id]/bank-accounts/[accountId]/reconcile/` e `.../lines/[lineId]/` |
| Tela de duas colunas | `app/clients/[id]/bank/[accountId]/reconcile/page.tsx` |
| Linha + proposta lado a lado | `components/ReconcileRow.tsx` |

Como a proposta é decidida — sinais em ordem de quão difícil é produzi-los por
acidente: número do documento na descrição (50) > valor igual ao **saldo em
aberto** (30) > nome do fornecedor na descrição (15) > proximidade de data
(até 10). Direção errada (saída contra venda) tira 40 e aparece dito na tela.

Decisões tomadas na implementação:
- **O limiar de confiança é 45, e isso é onde dois sinais independentes
  concordam** (nome + valor exato). Começou em 55 e estava errado: a mesma nota
  era proposta com a data a 3 dias e deixava de ser a 4, porque só então o bônus
  de data caía. Evidência idêntica com resultado diferente por causa de dois
  dias é ruído. Pior: como a maioria dos extratos não traz o número do
  documento, na prática quase nada era proposto.
- **Empate não vira proposta.** Dois candidatos com a mesma pontuação vão os
  dois para a lista. Escolher um no par ou ímpar e recebê-lo confirmado num
  clique é como se cria vínculo errado sem ninguém ter decidido nada.
- **Número curto é ignorado** (menos de 4 caracteres): "14" casaria com qualquer
  descrição.
- **Palavras de ruído no nome não contam** (`ltd`, `limited`, `the`, `services`,
  `ireland`…), senão meio mundo de fornecedor casa com meio mundo de linha.
- **Só documento em aberto é candidato.** Oferecer nota já paga é como um
  segundo pagamento se gruda nela.
- **Religar a movimento já lançado**, sem criar nada. Apareceu testando:
  desconciliar deixava o pagamento lançado e sem vínculo, e a única ação que
  sobrava na tela era "sem documento" — que criaria um SEGUNDO movimento e
  contaria o mesmo dinheiro duas vezes.
- **`force-dynamic` em toda rota de banco.** O Next 14 cacheia `GET` por padrão,
  e a tela continuava mostrando linha já conciliada depois de recarregar. Em
  conciliação, tela desatualizada é pior que tela lenta.

Verificado na tela, ponta a ponta (2026-08-10):
- [x] Pagamento de nota lançada → proposto sozinho, com o motivo escrito
- [x] Recebimento com o número da venda na descrição → propõe a venda
- [x] Confirmar → nota vira **paga** (`invoice_payment_status`)
- [x] Desconciliar → linha volta, pagamento continua lançado e aparece em
      "pagamentos em aberto"
- [x] Religar → **continua 1 movimento**, não 2
- [x] Refazer → movimento apagado, documento volta a dever
- [x] Linha sem documento parecido → nenhuma proposta inventada

**Entrega**
- Tela de duas colunas: linha do extrato à esquerda, proposta à direita
- **Sugestão de casamento** contra notas e vendas já lançadas, reaproveitando a
  lógica de força de sinal de `lib/duplicates.ts`. Empate desempatado pela data
  mais próxima, como no Xero
- Link "outras correspondências possíveis" quando há vários candidatos
- Confirmar → cria o pagamento, vincula, marca a nota
- **Duas operações de desfazer distintas**, e isto não é detalhe:
  - **Desconciliar** — remove só o vínculo; o pagamento continua na nota
  - **Refazer** — apaga a transação criada e devolve a linha
- Marcar cada conciliação com **o motivo** (casamento, regra, memória, manual)

**Testável quando:**
- [x] Linha de pagamento de nota lançada → sistema propõe sozinho
- [x] Confirmar → nota fica paga
- [x] Desconciliar → linha volta, pagamento continua na nota
- [x] Refazer → transação some, nota volta a em aberto

---

## Camada A3 — Regras de banco `[x] CONCLUÍDA (2026-08-10, v1.22)`

Entregue:

| O quê | Onde |
|---|---|
| Motor de regras (função pura, 27 testes) | `lib/bankRules.ts` |
| Guardar e reordenar | `lib/bankRulesStore.ts` |
| Rotas | `app/api/clients/[id]/bank-rules/` |
| Tela de regras, na ordem de avaliação | `app/clients/[id]/bank/rules/page.tsx` |
| Regra editável no lugar | `components/BankRuleCard.tsx` |

Decisões tomadas na implementação:
- **A regra é aplicada na conciliação, não na importação.** O plano dizia
  "próxima importação já vem preenchida"; aplicar na conciliação é melhor pelo
  mesmo motivo: a regra criada hoje passa a valer para o extrato importado
  ontem, sem reimportar nada.
- **Regra nova nasce no fim da fila.** Nascer no topo faria dela a primeira a
  casar, engolindo em silêncio o que já estava configurado e funcionando.
- **A tela avisa qual regra nunca vai acontecer**, com nome e tudo
  (`findShadowedRules`). Esse erro é mudo: a regra específica está lá, escrita
  certa, e simplesmente nunca dispara. O aviso é conservador — só acusa quando
  dá para provar que uma cobre a outra.
- **Regra sem condição não casa com nada.** Seria sempre engano de quem
  cadastrou, e o estrago é grande porque ela pararia todas as outras.
- **Número/valor comparado pela magnitude**: o contador pensa em "acima de 500",
  não em "menor que −500".
- **A sobra do arredondamento vai para a maior parcela.** 33,33% de €100 três
  vezes dá €99,99, e a gravação recusa divisão que não fecha com a linha —
  deixar passar seria criar dinheiro dentro do sistema.

Verificado na tela, ponta a ponta (2026-08-10):
- [x] Criar regra → a conciliação já chega preenchida
- [x] Regra genérica acima da específica → **aviso na tela**, com nome
- [x] Subir a específica com a seta → aviso some e ela passa a valer
- [x] Divisão 50/50 de −€4,50 → dois movimentos de −€2,25, soma exata,
      contas e alíquotas gravadas, motivo `rule`

### Desenho original da camada

**Entrega**
- Regras por cliente: condições (todas ou qualquer), campos (descrição,
  beneficiário, valor, referência), operadores (igual, contém, começa com)
- Escopo: uma conta ou todas
- O que gera: fornecedor, conta contábil, alíquota — com **divisão por valor
  fixo ou percentual** em várias contas
- **Ordem importa: para na primeira regra que casa.** Regra genérica no topo
  engole a específica — a tela precisa deixar reordenar e avisar disso
- Regra **sugere**, nunca cria sozinha

**Testável quando:**
- [x] Criar regra → próxima conciliação já vem preenchida
- [x] Regra genérica no topo não engole a específica (avisa e deixa reordenar)
- [x] Divisão percentual entre duas contas fecha o valor da linha

---

## Camada A4 — Casos difíceis `[x] CONCLUÍDA (2026-08-11, v1.24)`

Entregue:

| O quê | Onde |
|---|---|
| Motor de divisão (função pura, 31 testes) | `lib/bankSplit.ts` |
| Várias partes numa linha, cada uma com seu documento | `parts` em `lib/bankReconcile.ts` |
| Painel de divisão com "falta X para fechar" ao vivo | `components/SplitSettlement.tsx` |

Duas regras mandam em tudo:

1. **A soma das partes é o valor da linha.** Sempre, e o botão de gravar só
   acende quando fecha. Uma conciliação que não fecha não prova nada, e provar
   é o motivo de a conciliação existir.
2. **Diferença não some em silêncio.** Um cêntimo vira lançamento visível numa
   conta de arredondamento; uma sobra maior exige que alguém diga em que conta
   ela vai. Nunca é somada no valor de uma nota — isso faria a nota parecer paga
   por um valor que ninguém emitiu.

Decisões tomadas na implementação:
- **Nunca oferecer mais do que o documento deve.** Pagar €500 numa nota de €100
  e deixar o sistema "resolver" é como nasce crédito fantasma. O excedente vira
  sobra a explicar.
- **Valor digitado manda no automático.** O preenchimento automático divide o
  que sobrar; o contrário faria o sistema discordar de quem está decidindo.
- **Cinco cêntimos é o limite do arredondamento.** Conversão de moeda e desconto
  de fornecedor produzem esse resto; tarifa bancária, nunca. Acima disso o
  sistema não chama de arredondamento.
- **Pagamento parcial não precisa de nada especial**: a nota recebe o que foi
  pago e continua devendo o resto, porque a situação de pagamento é a view
  `invoice_payment_status` — derivada, não um campo mantido à mão (camada A0).

Verificado na tela, ponta a ponta (2026-08-11):
- [x] Um pagamento de €195,45 cobrindo **três notas** → 3 movimentos, as três pagas
- [x] €30,00 numa nota de €30,09 → nota fica **parcial**, devendo €0,09
- [x] €88,12 numa nota de €88,10 → nota recebe **88,10 exatos** e os 2 cêntimos
      vão para a conta 9999 como lançamento próprio
- [x] €33,36 numa nota de €28,58 → €4,78 lançados em "Tarifas bancárias"
- [x] Soma que não fecha e sem conta escolhida → **não deixa gravar**

### Desenho original da camada

**Entrega**
- **Um pagamento, várias notas**: marca várias, soma tem que bater
- **Pagamento parcial**: divide, o saldo continua em aberto para a próxima
- **Tarifa bancária** dentro da linha
- **Diferença de centavos**: ajuste para uma conta de arredondamento dedicada
- **Transação avulsa** para o que nenhum documento cobre

**Testável quando:**
- [x] Um pagamento cobrindo 3 notas concilia
- [x] Pagamento parcial deixa saldo em aberto correto
- [x] Diferença de 2 centavos vai para arredondamento, não trava o fechamento

---

## Camada A5 — Fechamento e relatório `[ ] não iniciada`

O que o escritório usa para provar que o mês fecha.

**Entrega**
- **Resumo de conciliação**: saldo no sistema, pagamentos em aberto, linhas não
  conciliadas, saldo calculado do extrato, **saldo final digitado pelo
  contador**, e a **diferença**
- **Exceções**: linhas apagadas, duplicatas em potencial
- Trava de período (cadeado) impedindo refazer em mês fechado

**Testável quando:**
- [ ] Tudo conciliado → diferença zero
- [ ] Falta uma linha → diferença aponta exatamente ela

---

## Camada A6 — Extrato em PDF `[x] CONCLUÍDA (2026-08-11, v1.23)`

Estava planejada por último, e foi antecipada a pedido do usuário: é o que
destrava testar com extrato de banco de verdade.

Entregue:

| O quê | Onde |
|---|---|
| Texto do PDF → grade de células (função pura, 25 testes) | `lib/pdfStatement.ts` |
| Rota que recebe o arquivo | `.../bank-accounts/[accountId]/import/pdf/` |
| Leitura de extrato escaneado por IA (último recurso) | `statementRowsFromMedia` em `lib/extractor/gemini.ts` |
| Mesma tela de confirmação do CSV | `components/StatementImport.tsx` |

**O problema central do PDF: coluna vazia desaparece.** No texto extraído, a
linha de saída e a de entrada têm exatamente a mesma forma — data, descrição,
dois números. Não dá para saber pelo formato quem entrou e quem saiu.

**O primeiro extrato real (AIB, julho/2026) mostrou que é pior que isso:** o
texto sai sem espaço nenhum entre as colunas —

```
14 Jul 2026VDP-PREMIER LOTTER10.00412.80
```

— e nenhuma heurística de texto separa isso com segurança. A solução foi ler o
PDF **por coordenada** (`lib/extractor/pdfLayout.ts`): cada pedaço de texto tem
posição na página, e com ela a tabela volta a existir **com as células vazias no
lugar**. Débito, crédito e saldo estavam em faixas de `x` distintas — 296, 352 e
418 — e é só isso que distingue os três.

Onde o cabeçalho de colunas não existe, o caminho antigo (texto corrido) ainda
serve, e aí o sinal sai da aritmética do documento: com saldo corrido, o
movimento é `saldo − saldo_anterior`.

Decisões tomadas na implementação:
- **A primeira linha não tem saldo anterior**, então o sinal dela vem da
  **coluna** em que o número foi impresso — posição que o texto do PDF preserva
  — e são as linhas seguintes, essas sim conferidas contra o saldo, que dizem
  qual coluna é saída e qual é entrada. Cheguei a deduzir pelo sinal da linha
  seguinte, o que é só chute: uma entrada logo depois não torna a primeira uma
  entrada.
- **Quando o saldo não fecha, o leitor não finge.** Devolve os números como
  colunas separadas e quem decide é o contador, na mesma tela do CSV.
- **IA é último recurso**, só para PDF sem camada de texto, e volta marcada como
  tal na tela. Custa, erra e não é reproduzível.
- **PDF não ganha atalho para gravar**: passa pelo mesmo mapeamento, mesma
  conferência contra o saldo e mesmo anti-duplicata.

**Defeito grave encontrado no caminho** (v1.23): o `pdf-parse` recusava
qualquer PDF dentro do Next com "Invalid PDF structure", enquanto o mesmo
arquivo lia sem problema no node puro. Causa: um `Buffer` do pool do Node começa
no meio de um bloco maior, e o pdf.js embutido lia a partir do início do bloco.
Como o `catch` devolvia `null` em silêncio, **toda nota fiscal em PDF nativo
vinha caindo na leitura por IA** desde sempre — pagando por IA e perdendo
precisão onde havia texto exato disponível. Uma cópia com `ArrayBuffer` próprio
resolve. Medido depois: 1 s em vez de 10 s por arquivo.

Verificado na tela, ponta a ponta (2026-08-11), com PDF gerado para teste e
depois com **extrato real do AIB** (3 páginas, 33 movimentos):
- [x] 33 movimentos lidos, saída e entrada na coluna certa
- [x] **Todos os 14 saldos impressos fecham** com a soma dos movimentos
- [x] Data do dia herdada pelos movimentos seguintes do mesmo bloco
- [x] Referência (`IE2607…`) e `TxnDate:` entram na descrição, não viram linha
- [x] Papel timbrado e cabeçalho repetidos nas páginas 2 e 3 não contaminam a
      última linha da página anterior
- [x] Saldo anterior (`BALANCE FORWARD`) reconhecido e não contado como movimento

Duas correções que só o extrato real revelou:
1. **Quebra de página contaminava a descrição.** Nome, endereço e "BALANCE
   FORWARD" impressos no topo da página seguinte eram tratados como continuação
   do último movimento da página anterior. Agora continuação só continua algo da
   **mesma página**, e tudo acima do cabeçalho de cada página é papel timbrado.
2. **A conferência contra o saldo dava alarme falso.** Ela somava apenas as
   linhas que trazem saldo, e este banco imprime o saldo **uma vez por dia**, na
   última linha do bloco. A conta nunca fechava. Agora soma todas as linhas
   entre um saldo e o seguinte — que é a aritmética certa e continua pegando
   sinal trocado no meio. Alarme falso é o jeito mais rápido de ensinar o
   contador a ignorar avisos.

### Desenho original da camada

**Entrega**
- Extrato em PDF pelo motor de extração existente, com tratamento próprio
  (tabela multipágina, cabeçalho repetido, saldo por linha)
- Baixa confiança → revisão humana antes de virar linha

**Testável quando:**
- [x] PDF de extrato vira linhas conferíveis *(PDF gerado para teste; falta um
      extrato real de banco)*
- [x] Total das linhas bate com o saldo final do PDF

---

## Camada A7 — Conciliação em massa `[ ] não iniciada`

**Entrega**
- Tela planilha, ordenável, seleção múltipla, propagação de conta
- **Só cria lançamentos avulsos** — nunca casa com documento. A ordem correta é
  conciliar primeiro o que tem documento
- Lote recomendado abaixo de 100 linhas

**Testável quando:**
- [ ] 50 linhas de tarifa conciliadas numa passada

---

# FASE B — Ingestão de documentos

> Pode começar em paralelo à Fase A a partir da A2, se houver fôlego. Não
> depende do modelo de dinheiro.

## Camada B1 — Regra por fornecedor `[ ] não iniciada`

A lacuna mais barata de fechar. O Dext decide categoria em três níveis:
**escolha manual → regra por fornecedor → modelo aprendido**. Vocês têm o
primeiro e o terceiro. Falta o do meio, que é o que o contador mais controla.

**Entrega**
- Regra por fornecedor e por cliente: conta contábil, alíquota, categoria
- Precedência explícita e visível na interface
- Interruptor **por fornecedor** para extrair itens de linha (hoje sempre
  ligado; o Dext deixa desligado por padrão — economia de tempo e custo de IA)

**Testável quando:**
- [ ] Regra sobrepõe a categorização aprendida
- [ ] Escolha manual sobrepõe a regra
- [ ] Fornecedor com linha desligada não gasta extração de itens

---

## Camada B2 — Entrada por e-mail `[ ] não iniciada`

O de maior impacto do Dext. O endereço pode ser dado **direto ao fornecedor** —
aí o cliente não faz nada e a fatura chega sozinha.

**Entrega**
- Endereço dedicado **por cliente**, e separado para compra e venda
- Anexos viram itens na fila de extração existente
- Modo "cada página vira um documento" para PDF com várias notas — vocês já têm
  o split por conteúdo (v1.12), então é reuso
- Texto do corpo vira a descrição
- Lista de remetentes permitidos/bloqueados
- **Decidir onde a caixa de e-mail vive.** Rodando no servidor local sem
  exposição à internet, a opção realista é o servidor **buscar** por IMAP numa
  caixa do escritório, não receber SMTP. A caixa é do escritório, não de
  terceiro processador

**Testável quando:**
- [ ] E-mail com PDF → item na fila
- [ ] E-mail com 3 anexos → 3 itens
- [ ] PDF de 5 notas → 5 itens
- [ ] Corpo do e-mail vira descrição
- [ ] Remetente bloqueado é recusado
- [ ] Mesmo documento duas vezes → marcado duplicata, não duplicado

---

## Camada B3 — Melhorias de revisão `[ ] não iniciada`

**Entrega**
- **Juntar duplicatas**: comparar lado a lado e anexar as duas imagens ao mesmo
  lançamento, em vez de só descartar
- Trilha de auditoria por documento: quem mudou o quê e quando
- Fila de aprovação em lote

**Testável quando:**
- [ ] Duplicata permite juntar as duas imagens num item só
- [ ] Trilha mostra o histórico de alterações
- [ ] Aprovar 20 itens de uma vez

---

# O que decidimos NÃO construir

| Item | Motivo |
|---|---|
| Busca de fatura em portal de fornecedor | Exige guardar credencial de terceiro. Passivo de segurança incompatível com o self-host |
| Conexão automática ao banco (Open Banking) | **Adiado, não descartado** — ver abaixo |
| Integração com Dext | Não existe API pública |
| Conciliação em cima do Xero | A Xero declara que não vai expor |
| Integração com Xero como destino | Adiada. Continua no backlog como item futuro, e o tier gratuito bastaria |

---

# Guardado para o futuro — Open Banking e distribuição do produto

Decisão do usuário em 2026-08-09: a conexão automática ao banco fica **adiada,
não descartada**. A intenção declarada é, se o produto der certo, **distribuir
o programa**, com proteção de propriedade intelectual e homologação.

Anotado agora para que a decisão de hoje não seja lida amanhã como "descartamos
Open Banking".

## O que muda quando isso entrar

A importação de arquivo (Camadas A1 e A6) **continua necessária** mesmo com
Open Banking — sempre haverá banco sem cobertura, conta antiga, e período
anterior à conexão. O plano atual não vira trabalho jogado fora; o Open Banking
entra como **mais um canal de entrada** para as mesmas `bank_statement_lines`.

Por isso a Camada A0 já registra a **origem** de cada linha (`source`). Quando o
canal automático existir, é só mais um valor ali.

## O que vai ser exigido (levantado da pesquisa, a confirmar antes de investir)

- **Licença de AISP** (Account Information Service Provider) junto ao Banco
  Central da Irlanda, sob a PSD2. É o passo caro e demorado — não é técnico.
  Referência do que é possível sem licença própria: a **própria Xero não tem**
  licença irlandesa; ela é registrada como AISP pela autoridade dinamarquesa e
  usa a **Tink** (AISP sueca) como intermediária técnica na Irlanda.
- **Alternativa realista**: usar um agregador licenciado (Tink, TrueLayer,
  Yapily, Plaid) em vez de obter licença própria. Mas isso **quebra a premissa
  de que dado nenhum sai** — o agregador vê as transações. Precisa de decisão
  explícita do escritório, e provavelmente de consentimento dos clientes finais.
- **Renovação periódica de consentimento** é exigência do padrão Open Banking,
  não escolha de produto. A conexão expira e precisa ser reautorizada.

## Sobre patente e distribuição — verificar com advogado antes de contar com isso

Duas coisas que costumam surpreender, e que é melhor saber cedo:

- **Software puro e método de negócio geralmente não são patenteáveis na
  Europa.** A Convenção Europeia de Patentes exclui expressamente "programas de
  computador como tais" e métodos de negócio. Patente exige, na prática,
  demonstrar efeito técnico além do processamento de informação. Conciliação
  bancária e leitura de nota tendem a cair na exclusão.
- **O que de fato protege**, e já vale hoje sem custo: **direito de autor** sobre
  o código (automático, desde que escrito), **segredo de negócio** sobre a base
  de alíquotas e as regras acumuladas, e **marca registrada** sobre o nome do
  produto — essa sim é registrável e barata.

Nada disso é aconselhamento jurídico, e a decisão é de vocês com um advogado de
PI. Está aqui só para o orçamento não ser feito em cima de uma expectativa que
pode não se confirmar.

Já a **homologação** é real e depende do que o produto fizer: se um dia
transmitir ao ROS, há requisitos da Revenue; se conectar a banco, há a licença
acima. Ambos são caminhos conhecidos, só não são rápidos.

## Impacto na arquitetura de hoje: nenhum

O que estamos construindo agora não muda por causa disso. **Se o produto for
distribuído, o self-host vira vantagem comercial** — cada cliente instala e
mantém o dado em casa, que é exatamente o que a concorrência em nuvem não
oferece.

---

# Ordem sugerida e por quê

**A0 → A1 → A2** é o caminho crítico: sem dinheiro modelado, sem extrato
importado e sem casamento, não existe conciliação. Essas três entregam o núcleo.

**A3 (regras)** vem logo em seguida porque é o que faz o segundo mês ser mais
rápido que o primeiro. É onde o contador sente que o sistema aprende.

**B1 (regra por fornecedor)** é barata e pode entrar em qualquer intervalo.

**A5 (relatório)** antes de A6 e A7: é o que dá confiança ao escritório de que o
número está certo.

> **Lição do Xero que vale para o plano inteiro:** o valor não está em nenhuma
> tela isolada, está em a conciliação **nunca começar do zero**. Documento
> ingerido, regra configurada e memória se acumulam até o dia a dia virar
> cliques de confirmação. Implementar só "casar linha com nota" reproduz uma
> camada e perde o que faz funcionar em escala.

---

# Registro de progresso

| Data | Camada | Estado | Tag |
|---|---|---|---|
| 2026-08-09 | — | Pesquisa concluída, plano escrito | — |
| 2026-08-10 | A0 | Modelo de dinheiro no banco, verificado | v1.19 |
| 2026-08-10 | A1 | Leitor de extrato + 72 testes (`npm test`) | v1.19.1 |
| 2026-08-10 | A1 | Interface, importação e anti-duplicata; 92 testes | v1.20 |
| 2026-08-10 | A1 | Recusa de desfazer deixa de ter cara de sucesso | v1.20.1 |
| 2026-08-10 | A2 | Sugestão de casamento, conciliar/desconciliar/refazer; 115 testes | v1.21 |
| 2026-08-10 | A3 | Regras de banco com ordem, aviso de regra engolida e divisão; 142 testes | v1.22 |
| 2026-08-10 | — | Cache de rota do Next fazia lista voltar vazia (26 rotas) | v1.22.1 |
| 2026-08-11 | A6 | Extrato em PDF + correção do `pdf-parse` que derrubava toda leitura nativa; 167 testes | v1.23 |
| 2026-08-11 | A6 | Leitura por coordenada; primeiro extrato REAL (AIB) lido inteiro; 184 testes | v1.23.1 |
| 2026-08-11 | A4 | Casos difíceis: várias notas, parcial, tarifa e arredondamento; 215 testes | v1.24 |

**Onde parou: A4 concluída. A próxima é a A5 — fechamento e relatório**, que é
o que o escritório usa para provar que o mês fecha. Depois dela sobra só a A7
(conciliação em massa) na Fase A, e a Fase B inteira.

O primeiro extrato real chegou em 2026-08-11 (AIB, julho) e virou o teste que
mais ensinou até agora. **Quando chegarem extratos de outros bancos, o certo é
acrescentar cada um como caso** em `tests/pdfStatement.test.js` — usando as
coordenadas, nunca o arquivo, que tem dado de cliente.
