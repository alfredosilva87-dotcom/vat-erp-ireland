# Xero — o que faz, e o que copiar da metodologia

> Levantado em 2026-08-09 a partir da documentação oficial (central.xero.com,
> developer.xero.com). Objetivo: entender o **método de trabalho** da
> conciliação bancária para construir equivalente dentro do VAT ERP, rodando
> no servidor local. Nunca copiar UI, marca ou conteúdo — só a mecânica.

---

## 1. Dois achados que mudam a estratégia

### 1.1 O Xero é fraco na Irlanda — e isso é uma oportunidade

**A Irlanda não tem edição própria do Xero.** Roda na *Global Edition*, a
mesma do "resto do mundo". Consequências, todas confirmadas na documentação:

- As tax rates que vêm de fábrica são **quatro, todas 0%**. O contador irlandês
  cria 23%, 13,5%, 9%, 4,8%, zero-rated e reverse charge **à mão**.
- **Não existe formulário VAT3.** Existe um "Sales Tax report" genérico, que a
  própria Xero descreve como "pode conter mais informação do que você precisa".
- **O Xero não transmite para o ROS.** Para gerar o VAT3 é preciso um plugin de
  terceiro (Parolla), que a própria Xero indica na documentação e promove na
  app store irlandesa.

E o motivo pelo qual esse plugin existe é o ponto mais importante de todos:

> A base irlandesa **"Monies Received"** não é regime de caixa nem de competência
> puros — é **híbrida: vendas por competência, compras por caixa**. O relatório
> nativo do Xero "não foi desenhado para Irish Monies Received reporting".

**Se o ERP de vocês fizer isso direito, vocês estão à frente do Xero na
Irlanda.** Não é marketing: é uma lacuna documentada, aberta em 2026, que a
Xero terceiriza. Some-se a isso o RTD, para o qual não achei suporte nem no
Xero nem no Parolla.

### 1.2 Não dá para construir conciliação em cima do Xero

A documentação da API é categórica:

> "Xero não suporta reconciliar bank statement lines via Accounting API, e
> **não planejamos adicionar essa capacidade**. Dados de statement não
> reconciliados **não são expostos** por APIs públicas, por restrições
> regulatórias, contratuais e de risco."

E a *Bank Feeds API* é fechada — só para instituições financeiras com parceria
formal com a Xero.

**Conclusão:** conciliação bancária é exatamente a parte que o Xero mantém
dentro dos próprios muros. Não há o que integrar. Construir é o único caminho —
a mesma conclusão do Dext, por motivo diferente.

---

## 2. O modelo de dados — o núcleo a copiar

O Xero mantém **duas séries separadas** por conta bancária, e conciliar é
**criar o vínculo entre elas**:

| Lado | O que é | Origem |
|---|---|---|
| **Statement lines** | Linhas do extrato do banco. Imutáveis. | Feed ou importação |
| **Account transactions** | O que existe no sistema: notas, vendas, pagamentos, transferências | Lançamento, regra, ingestão |

Disso saem **dois saldos diferentes**, e entender isso é o coração do domínio:

- **Saldo do extrato** = saldo inicial + todas as linhas importadas
- **Saldo no sistema** = saldo inicial + todas as transações lançadas ← *este é
  o que vai para o balanço*

**Conciliar não muda nenhum dos dois saldos.** Só cria o vínculo. A diferença
entre eles é explicada por linhas não conciliadas de um lado ou do outro — e é
exatamente isso que o relatório de conciliação mostra.

> Essa é a lição de arquitetura mais importante do relatório inteiro. Um clone
> que só marque a nota como "paga" perde a capacidade de provar que o mês fecha.

---

## 3. O motor de sugestões — quatro camadas em cascata

É isto que dá a sensação de que "o Xero adivinha". São mecanismos distintos,
aplicados em ordem:

**Camada 1 — Casar com transação existente.** Compara todos os campos da linha
do extrato contra todas as transações do sistema. A de maior similaridade é
oferecida. **Empate é desempatado pela data de vencimento mais próxima.** Se há
vários candidatos, mostra "outras correspondências possíveis".

**Camada 2 — Regras de banco.** Se nada casou, avalia as regras. Se a linha
satisfaz as condições, o sistema **sugere** uma transação já preenchida — nunca
cria sozinho. O usuário aceita, edita ou ignora.

**Camada 3 — Memória.** Usa conciliações passadas com beneficiário e referência
parecidos, e sugere o mesmo destino.

**Camada 4 — Predição.** Último recurso: prevê fornecedor e conta a partir do
texto da linha. **As predições aparecem em itálico**, para o contador saber que
é chute do sistema e não histórico — detalhe de interface que vale copiar.

Existe ainda uma camada opcional de auto-conciliação para linhas de alta
confiança, que **rotula cada conciliação com o motivo** (`Regra`, `Match`,
`Memória`, `Predição`, `Manual`). Rastreabilidade de por que o sistema decidiu.

---

## 4. Regras de banco — especificação

Uma regra tem três partes:

**Condições.** `Todas as condições` (restritiva) ou `Qualquer condição`
(frouxa). Campos: beneficiário, descrição, valor, referência, conta bancária, e
"qualquer campo de texto". Operadores: igual a, contém, começa com, está vazio.

**Escopo.** Uma conta bancária específica ou todas.

**O que gera.** Fornecedor (existente, novo, ou "usar o beneficiário da linha"),
referência, e **alocação por valor fixo ou percentual** — com divisão em várias
contas, cada uma com sua alíquota. O exemplo oficial: taxa fixa do telefone numa
conta, o resto rateado entre pessoal e empresa.

**A ordem importa, e é o comportamento mais sutil:** as regras são avaliadas na
ordem da tela e **para na primeira que casa**. Regra genérica no topo engole as
específicas. A documentação recomenda explicitamente pôr as restritivas primeiro.

> Aviso da própria Xero: regra de banco é para linha que **não** vai ter
> documento. Se existe nota, use o casamento.

---

## 5. Os casos difíceis

Cinco cenários que a tela de casamento precisa cobrir:

- **Um pagamento, várias notas.** Marca várias; quando a soma bate com a linha,
  libera conciliar.
- **Pagamento parcial.** Seleciona a nota → **dividir** → digita o valor →
  concilia. O saldo continua em aberto para a próxima parcela.
- **Tarifa bancária.** Ajuste dentro da própria linha.
- **Diferença de centavos.** Ajuste menor, lançado numa conta de arredondamento
  dedicada.
- **Transação adicional.** Para a parte que nenhum documento cobre.

E **duas operações de desfazer, que são diferentes** — distinção que clones
costumam ignorar:

- **Refazer**: apaga a transação criada e devolve a linha para não conciliada.
  Usa quando o sistema criou a coisa errada.
- **Desconciliar**: remove **só o vínculo**. O pagamento continua aplicado à
  nota. Usa quando o pagamento está certo mas foi casado com a linha errada.

Período travado mostra cadeado e não aceita refazer.

---

## 6. Conciliação em massa

Tela em formato planilha, até 200 linhas, ordenável por coluna. **Só cria
lançamentos avulsos — nunca casa com documento existente.** Por isso a ordem
obrigatória é: primeiro concilia tudo que tem documento, depois usa a massa
para o resto.

Seleciona várias linhas → escolhe a conta → o valor propaga → salva tudo.
Recomendação oficial: menos de 100 linhas por vez. Sem beneficiário informado,
cria contra um fornecedor chamado "Desconhecido".

---

## 7. O relatório que prova que o mês fecha

O pacote tem três peças, e é o que o escritório realmente usa:

**Resumo de conciliação** — mostra: saldo no sistema, total de pagamentos em
aberto, total de linhas não conciliadas, saldo calculado do extrato, **saldo
final digitado pelo contador** (lido do internet banking) e a **diferença**.
Fechou quando a diferença é zero.

**Extrato** — com coluna de origem: importação manual, feed, ou "criado por
usuário marcando como conciliado".

**Exceções** — linhas apagadas e duplicatas em potencial.

---

## 8. Ingestão de documentos no Xero

Duas vias, e ambas são **mais fracas que o que vocês já têm**:

**E-mail para a organização.** Um endereço único, o documento tem que ser
anexo, até 10 por e-mail e 25MB. Gera rascunho com fornecedor, data, total,
vencimento e referência preenchidos. Campos adivinhados ganham **ícone de raio**.

**Hubdoc** (incluído nos planos). Extrai data, fornecedor e total como mínimo
obrigatório, mais número e vencimento.

> **O Hubdoc não extrai itens de linha.** Vocês extraem. A extração de imposto
> dele falha declaradamente em documento com tributação mista — recibo de
> supermercado com itens isentos e tributados, que é justamente o caso que
> vocês já resolveram (v1.13/v1.14). Vocês estão à frente aqui.

Detecção de duplicata do Hubdoc: mesma data + fornecedor + total; havendo
número da nota, os dois precisam ter o mesmo número.

Publicação: abaixo de 3MB o documento vira anexo; acima, vira só um link.

**O elo que fecha o ciclo:** documento ingerido vira transação no sistema →
quando a linha do pagamento chega no extrato, a Camada 1 encontra e propõe.
**Quanto melhor a ingestão, menos trabalho na conciliação.** As duas features
são um sistema só, não duas.

---

## 9. Objetos centrais (para comparar com o modelo de vocês)

- **Plano de contas**: código até 10 caracteres, tipos com *comportamento* (uma
  compra lançada em conta de imobilizado cria rascunho de ativo fixo). **Cada
  conta tem alíquota padrão.** Contas de sistema não deletáveis: clientes,
  fornecedores, VAT, arredondamento, lucros acumulados.
- **Contato é um só** para cliente e fornecedor; as flags são derivadas. Tem
  alíquota padrão e conta padrão **separadas para venda e compra**.
- **Nota de venda e nota de compra são a mesma entidade**, discriminada por
  tipo. O número é único na venda e **não único** na compra.
- **Herança de alíquota**: conta do plano → sobrescrita pelo padrão do contato →
  sobrescrita pela escolha na linha.
- **Casar linha com nota cria um Pagamento** aplicado a ela. É esse objeto que o
  "refazer" remove.

---

## 10. O loop real numa prática

1. As linhas do extrato chegam sozinhas (feed) ou por importação.
2. Documentos chegam em paralelo e viram rascunhos.
3. O contador desce a lista de conciliação clicando em confirmar no que o
   sistema acertou. **O trabalho real é o resíduo.**
4. Casos difíceis vão para a tela de casamento.
5. O que ninguém sabe o que é vira **pergunta ao cliente na própria linha** —
   conciliação é trabalho de duas pessoas, não tarefa solitária.
6. O volume que sobra vai para a conciliação em massa.
7. **Cria-se regra para o que se repetiu** — cada mês deveria ser mais rápido
   que o anterior.
8. No fechamento: relatório de conciliação até a diferença zerar, depois o VAT.

> **O padrão a extrair:** o valor não está em nenhuma tela isolada, está em
> **a conciliação nunca começar do zero**. Documento ingerido, regra
> configurada, memória e predição se acumulam até a operação diária virar
> cliques de confirmação. Um clone que só implemente "casar linha com nota"
> reproduz a Camada 1 e perde o que faz a coisa funcionar em escala.

---

## 11. Se um dia quiserem integrar (não é o plano agora)

- OAuth 2.0. Token de acesso 30 min, refresh 60 dias.
- **Conexão do tipo "Custom Connection" não está disponível na Irlanda** — só
  Austrália, Nova Zelândia, UK e US. Integrador irlandês usa fluxo com
  consentimento por usuário.
- Tier gratuito: 5 conexões, 1.000 chamadas/dia. **Suficiente para uma prática
  pequena, sem certificação.**
- Limites: 60 chamadas/min e 5 simultâneas por organização.
- **Webhooks só para contato, nota e nota de crédito.** Nada de banco.
- Desde dez/2025: proibido usar dados da API para treinar modelos de IA.

---

## 12. O que testar depois de implementado

- [ ] Importar extrato → linhas aparecem com saldo correndo
- [ ] Importar o mesmo arquivo de novo → nenhuma linha duplicada
- [ ] Linha de pagamento de uma nota lançada → sistema propõe o casamento
- [ ] Confirmar o casamento → a nota fica paga
- [ ] Desconciliar → a linha volta, o pagamento continua na nota
- [ ] Refazer → a transação some, a nota volta a "aguardando pagamento"
- [ ] Um pagamento cobrindo 3 notas → soma bate, concilia
- [ ] Pagamento parcial → nota fica com saldo em aberto
- [ ] Diferença de centavos → ajuste vai para conta de arredondamento
- [ ] Criar regra → próxima importação já vem preenchida
- [ ] Regra genérica no topo **não** engole a específica (ordem respeitada)
- [ ] 50 linhas conciliadas em massa numa passada
- [ ] Relatório: diferença zero quando tudo está conciliado
- [ ] Relatório: diferença aponta exatamente o que falta

---

## O que ficou sem confirmar

- Se o Xero passou a submeter VAT3 direto ao ROS. Uma fonte de terceiro afirma
  que sim; **todas as fontes Xero apontam o contrário**. Tratado como não
  confirmado e provavelmente incorreto.
- Suporte a RTD — nenhuma menção em fonte Xero nem Parolla.
- Quais bancos irlandeses têm feed hoje, e de que tipo.
- O algoritmo de pontuação do casamento sugerido (a doc descreve
  qualitativamente, não publica pesos nem limiares).
- Os critérios de "alta confiança" da auto-conciliação.
