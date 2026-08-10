# Dext — o que faz, e o que copiar da metodologia

> Levantado em 2026-08-09 a partir da documentação oficial (help.dext.com).
> Objetivo: entender o **método de trabalho** para construir equivalente
> dentro do VAT ERP, rodando no servidor local. Nunca copiar UI, marca ou
> conteúdo — só a mecânica.

## Resumo em uma linha

Dext é uma camada de **pré-contabilidade**: captura documentos por vários
canais, extrai os campos, deixa o contador revisar numa caixa de entrada, e
publica o resultado como lançamento no Xero/QuickBooks/Sage — levando junto a
imagem original.

---

## 1. O achado que decide a arquitetura

**Não existe API pública para captura, extração ou publicação.**

- O pedido "Dext API Access" no fórum oficial está **"Under Review" desde
  2021**, com 185 votos e comentários até janeiro de 2026. A última resposta
  oficial (Dext, 24/11/2021) aponta o Zapier como alternativa.
- A única API documentada é a de **Data Health & Insights**
  (`api.precision.dext.com`, Bearer token, 60 req/min): devolve *métricas* de
  qualidade de dados de um ledger Xero/QBO já existente. **Não expõe captura,
  extração, imagens, line items nem publicação.**
- O substituto de fato é o **conector Zapier** — empurra imagem para dentro,
  puxa campos extraídos para fora. Passa por nuvem de terceiro, o que colide
  frontalmente com o requisito de manter tudo local.

**Consequência:** o Dext não é integrável. É substituível. Isso valida a
decisão de construir equivalente em vez de integrar.

---

## 2. Como os documentos entram

Em ordem de utilidade para o nosso caso:

| Canal | Como funciona | Vale copiar? |
|---|---|---|
| **E-mail dedicado** | Endereço único **por usuário e por conta**, e **separado para compras e vendas**. O destinatário define o dono do documento — o roteamento vem do endereço, não do remetente. Dois modos: *single* (um arquivo = um item) e *multiple* (**cada página vira um item**, limite 200 páginas). Corpo do e-mail ignorado, exceto `#note`, que vira a descrição. Dá para bloquear remetentes. Aceita imagens, PDF, DOC, e ZIP com imagens. | **Sim — é o de maior impacto.** O endereço pode ser dado direto ao fornecedor, e aí o cliente não faz nada. |
| **Foto pelo celular** | App captura → revisa → envia. O ponto de entrada define se é compra ou venda. Dá para pré-selecionar categoria, e essa escolha manual **tem precedência sobre tudo**. | Sim, mas depende de app ou de web mobile. |
| **Arrastar arquivo** | Já existe no sistema de vocês. | Já temos. |
| **Extrato bancário** | Fluxo **separado** do de notas: cria a conta em Bank > Accounts (banco, nome, número, moeda), depois sobe **um extrato por arquivo** para aquela conta. Estados: *Collected* → *Processed*. PDF nativo em minutos; digitalizado até 24h. Só Admin pode subir. | **Sim — é exatamente a nossa camada 1.** |
| **WhatsApp** | Ativado por usuário com verificação de telefone. A **legenda da mensagem vira a descrição** do item. | Interessante, mas exige API de negócio do WhatsApp. |
| **Fetch de fornecedor** | Busca faturas direto no portal do fornecedor. Exige **guardar as credenciais do portal dentro do Dext**. Coleta inicial em 48h, depois verifica a cada 7 dias. | **Não copiar.** Guardar credencial de terceiro é passivo de segurança que vocês não querem. |

---

## 3. O que acontece depois que entra

### Campos extraídos (checklist de paridade)

Tipo de documento, data, vencimento, fornecedor/cliente, moeda, número da
ordem de compra, total, imposto, número da fatura, referência, categoria,
descrição, forma de pagamento (últimos 4 dígitos do cartão), e a imagem
original — tratada como dado, não como anexo secundário.

> ⚠️ O **VAT number só é extraído para documentos do Reino Unido**, segundo a
> documentação. Não achei confirmação para Irlanda. Como o sistema de vocês é
> irlandês, isso é uma vantagem, não uma lacuna a copiar.

### Line items

**Desligado por padrão.** É um interruptor **por fornecedor** — liga-se para o
supermercado que manda 80 linhas, deixa desligado para a conta de luz. Também
dá para extrair linhas sob demanda num documento específico. Existe
**agrupamento de linhas** por descrição e/ou alíquota, o que evita revisar 80
itens quando 3 grupos bastam.

> Isso é uma lição de desempenho e de custo: extrair linha a linha é caro e
> lento. Vocês já extraem linhas sempre — vale considerar o interruptor por
> fornecedor.

### Detecção de duplicata — regras exatas

- **Recibos**: fornecedor + data + valor total + dono do documento
- **Faturas e notas de crédito**: fornecedor + valor total + referência

Três modos configuráveis: **automático** (apaga sozinho, recuperável no
histórico), **revisão** (marca com ícone âmbar, o usuário compara lado a lado
e decide apagar **ou juntar as duas imagens num item só**), e **desligado**.

> O modo "juntar as duas imagens num item" é uma ideia boa que vocês não têm.

### Aprendizado

Dois mecanismos, e a ordem de precedência importa:

1. **Categoria escolhida à mão** (vence tudo)
2. **Regra por fornecedor** (determinística)
3. **Predição do modelo** (só depois de observar categorizações suficientes)

E corrigir um campo extraído **conta automaticamente como erro reportado** —
não existe botão de "reportar erro", a correção é o sinal.

> Vocês já têm o equivalente do nível 3 (`items_master`,
> `client_item_accounts`). Falta o nível 2: **regra por fornecedor**.

### O que o Dext **não** mostra

Não existe percentual de confiança por campo visível ao usuário. A qualidade
aparece pelo fluxo — marca de duplicata, aprovação, sugestões — não por
número.

> Vocês têm score de confiança e `needs_review`. É uma escolha diferente, e
> defensável. Vale só ter consciência de que o produto de referência decidiu
> o contrário.

### Revisão e estados

Estados: **Inbox → Ready → Archive**. A página do item salva sozinha a cada
alteração, tem trilha de auditoria completa (quem mudou o quê) e uma aba de
mensagens **contador ↔ cliente sobre aquele documento específico**.

Fluxos de aprovação: até 5 estágios, com opção de publicar automaticamente
depois de aprovado.

---

## 4. Publicação — a lição de arquitetura

A publicação é em **duas partes: o lançamento e a imagem**. A imagem pode
falhar sozinha (limite de tamanho do destino), e existe um botão
**"Republish image"** que reenvia **só a imagem, sem duplicar o lançamento**.

> Se um dia vocês exportarem para Sage/Bright/Xero, esse retry idempotente só
> da imagem é obrigatório, não luxo.

Destinos: Xero (compras viram *bills*, vendas viram *invoices*, conta bancária
vira *spend money*), QuickBooks, Sage, e outros. Também funciona **sem
software contábil conectado** — os itens param em *Ready* e se exporta.

O catálogo de erros de publicação do Xero (20+ mensagens: código de conta
arquivado, alíquota incompatível, **período fiscal travado**, permissão) é uma
boa lista de casos de borda.

---

## 5. O loop real numa prática pequena

**Cliente:** fotografa recibo na hora do gasto; encaminha fatura por e-mail —
ou dá o endereço direto ao fornecedor, e aí não faz nada.

**Contador, diário ou semanal:**
1. Abre a caixa de entrada do cliente — só o que já foi extraído.
2. Trata as marcas de duplicata.
3. Revisa os itens: já vêm preenchidos por extração + regra de fornecedor +
   categorização aprendida. O trabalho é aceitar ou corrigir — e **cada
   correção realimenta o modelo**.
4. Pergunta ao cliente pelos itens ambíguos, na própria página do item.
5. Publica em lote.
6. Trata as falhas de publicação.

---

## 6. O que testar depois de implementado

Derivado do que o Dext faz. Cada linha é um teste observável:

- [ ] Mandar e-mail com um PDF para o endereço do cliente → item aparece na fila
- [ ] Mandar e-mail com 3 anexos → 3 itens
- [ ] PDF de 5 páginas em modo "multiple" → 5 itens separados
- [ ] Texto no corpo do e-mail vira a descrição
- [ ] Remetente desconhecido/bloqueado é recusado
- [ ] Mesmo documento enviado duas vezes → marcado como duplicata, não duplicado
- [ ] Duplicata permite juntar as duas imagens num item só
- [ ] Regra por fornecedor sobrepõe a categorização aprendida
- [ ] Categoria escolhida à mão sobrepõe a regra
- [ ] Corrigir um campo faz o próximo documento do mesmo fornecedor vir certo
- [ ] Item tem trilha de auditoria de quem mudou o quê
- [ ] Fila em lote: aprovar 20 itens de uma vez

---

## O que ficou sem confirmar

- Campos exatos extraídos por linha (quantidade? preço unitário?).
- Se o VAT number irlandês é extraído (documentação diz UK apenas).
- Nomenclatura atual "Prepare"/"Precision" — o site oficial não usa mais, e
  a ligação Precision → Data Health & Insights é inferência.
- Retenção de 10 anos declarada citando HMRC; nada específico para a Revenue
  irlandesa.
- Se existe API sob acordo bilateral/NDA — não há programa público de
  desenvolvedores, portal, docs nem processo de inscrição.
- Webhooks: nenhuma documentação pública.

## Fontes principais

Toda a documentação em `help.dext.com`, com destaque para: submissão por
e-mail (416754), extração de campos (416691), duplicatas (216124),
auto-categorização (416739), regras de fornecedor (216125), extratos
bancários (455059), publicação no Xero (377055), erros de publicação (105833),
API de Data Health (272702), e o pedido de API no fórum oficial
(dext.uservoice.com, sugestão 42921498).
