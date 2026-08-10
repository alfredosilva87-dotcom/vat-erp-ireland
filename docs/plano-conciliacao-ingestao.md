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

## Camada A0 — Modelar dinheiro `[ ] não iniciada`

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

## Camada A1 — Importar extrato (CSV e Excel) `[ ] não iniciada`

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
- [ ] Importa extrato real de um banco → linhas aparecem com saldo correndo
- [ ] Importa o mesmo arquivo de novo → zero linhas duplicadas
- [ ] Importa extrato de **outro banco**, com formato diferente → mapeia uma vez
- [ ] Segunda importação daquele banco → automática

---

## Camada A2 — Conciliar com sugestão de casamento `[ ] não iniciada`

O coração. Equivale à Camada 1 do motor do Xero.

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
- [ ] Linha de pagamento de nota lançada → sistema propõe sozinho
- [ ] Confirmar → nota fica paga
- [ ] Desconciliar → linha volta, pagamento continua na nota
- [ ] Refazer → transação some, nota volta a em aberto

---

## Camada A3 — Regras de banco `[ ] não iniciada`

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
- [ ] Criar regra → próxima importação já vem preenchida
- [ ] Regra genérica no topo não engole a específica
- [ ] Divisão percentual entre duas contas fecha o valor da linha

---

## Camada A4 — Casos difíceis `[ ] não iniciada`

**Entrega**
- **Um pagamento, várias notas**: marca várias, soma tem que bater
- **Pagamento parcial**: divide, o saldo continua em aberto para a próxima
- **Tarifa bancária** dentro da linha
- **Diferença de centavos**: ajuste para uma conta de arredondamento dedicada
- **Transação avulsa** para o que nenhum documento cobre

**Testável quando:**
- [ ] Um pagamento cobrindo 3 notas concilia
- [ ] Pagamento parcial deixa saldo em aberto correto
- [ ] Diferença de 2 centavos vai para arredondamento, não trava o fechamento

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

## Camada A6 — Extrato em PDF `[ ] não iniciada`

Deixado por último de propósito: CSV e Excel cobrem a maioria dos bancos, e é
melhor chegar aqui com o resto já funcionando.

**Entrega**
- Extrato em PDF pelo motor de extração existente, com tratamento próprio
  (tabela multipágina, cabeçalho repetido, saldo por linha)
- Baixa confiança → revisão humana antes de virar linha

**Testável quando:**
- [ ] PDF de extrato real vira linhas conferíveis
- [ ] Total das linhas bate com o saldo final do PDF

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
| Conexão automática ao banco (Open Banking) | Exige licenciamento AISP e manda dado para fora. Importação de arquivo cobre o caso |
| Integração com Dext | Não existe API pública |
| Conciliação em cima do Xero | A Xero declara que não vai expor |
| Integração com Xero como destino | Adiada. Continua no backlog como item futuro, e o tier gratuito bastaria |

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
