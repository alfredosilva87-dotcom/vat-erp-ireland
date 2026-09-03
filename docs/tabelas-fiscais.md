# Tabelas fiscais — o que está cadastrado e o que falta conferir

> Material para a documentação do ERP. Estado em **2026-09-03**.
>
> **Nenhum destes valores foi conferido contra uma publicação oficial da
> Revenue.** O ecrã `RH → Tax tables` existe para o escritório os validar ou
> corrigir, e grava quem confirmou e quando.

## Por que isto é um cadastro e não uma constante

As taxas irlandesas mudam todos os anos no Orçamento, e o PRSI já mudou **a meio
do ano** duas vezes seguidas. Com os números no código, cada mudança exigiria
alterar, buildar e reimplantar em cada instalação — e a folha de Janeiro não
espera por isso.

O ecrã trabalha em **euros e por cento**, que é como a Revenue publica. O que vai
para o banco são cêntimos e pontos-base inteiros: escrever "20%" e guardar `0,2`
é como se perde um cêntimo por linha durante um ano inteiro.

## O que um recibo real já corrobora

O motor foi verificado contra um payslip do Sage de 2026 (semana 35, pessoa
solteira, base cumulativa) e fecha ao cêntimo em todas as linhas.

> O recibo em si **não está neste repositório**: é o recibo pessoal de alguém,
> com nome, PPS e salário. Os valores abaixo são o que dele se pode dizer sem o
> reproduzir.

| Valor | Como se confirma |
|---|---|
| Cut-off padrão solteiro **€44.000** | `teto(44000/52) = 846,16`, e `× 35` dá o `STD.CUT OFF` impresso |
| Créditos **€2.000 + €2.000** | `teto(4000/52) = 76,93`, e o `76,93` está impresso no campo `TAX CREDIT` |
| Taxa normal de PAYE **20%** | o `TAX PAID` acumulado reproduz-se com ela |
| PRSI empregado **4,20%** | bate ao cêntimo com a linha `PRSI` |
| PRSI empregador **11,25%** | bate com `EMPER PRSI PER` |
| Auto-enrolment **1,50%** de cada lado | bate com as duas linhas `AE Pension` |

## Por confirmar, por ordem de risco

1. **Tecto da banda de 2% do USC em 2026 — €28.700.**
   Este número **não foi lido em publicação nenhuma: foi deduzido.** É o único
   valor que reproduz o USC acumulado do recibo de referência; com o tecto de
   2025 (€27.382) o resultado difere em cerca de nove euros. Bate ao cêntimo, o
   que é bom sinal, mas um recibo não é a lei. Se estiver errado, o USC de toda
   a gente está errado.

2. **Todo o resto de 2026 é a tabela de 2025 copiada.**
   Solteiro está corroborado. Os valores de **casado, família monoparental e o
   máximo transferível** nunca foram verificados para 2026.

3. **Taxa superior de PAYE (40%).**
   O recibo de referência nunca passou do cut-off, portanto essa taxa não foi
   exercitada por verificação real nenhuma.

4. **Isenções e limiares de quem ganha pouco** — isenção anual de USC (€13.000),
   limiar semanal de PRSI (€352), crédito de PRSI (€12 até €424/semana). O
   recibo de referência está muito acima de todos eles, e é justamente a faixa
   dos part-times.

5. **Limiares do auto-enrolment** — rendimento mínimo (€20.000), tecto (€80.000)
   e idades (23–60). A taxa está corroborada; quem *entra* no esquema não.

## O que está cadastrado

### PAYE — valores anuais (2025 e 2026 idênticos neste momento)

| Campo | Nome no ecrã | Valor |
|---|---|---|
| Taxa normal | Standard rate | 20,00% |
| Taxa superior | Higher rate | 40,00% |
| Cut-off — solteiro | Cut-off — single | 44.000,00 |
| Cut-off — família monoparental | Cut-off — lone parent | 48.000,00 |
| Cut-off — casado, um salário | Cut-off — married, one income | 53.000,00 |
| Cut-off — casado, dois salários | Cut-off — married, two incomes | 53.000,00 |
| Máximo transferível | Cut-off — max transferable | 35.000,00 |
| Crédito pessoal — solteiro | Credit — personal (single) | 2.000,00 |
| Crédito pessoal — casado | Credit — personal (married) | 4.000,00 |
| Crédito de empregado | Credit — employee (PAYE) | 2.000,00 |
| Crédito família monoparental | Credit — lone parent | 1.900,00 |
| Emergência — semanas com cut-off | Emergency — weeks with cut-off | 4 |
| Emergência — cut-off semanal | Emergency — weekly cut-off | 846,15 |

### USC — bandas normais

| Banda | Taxa | Até (2025) | Até (2026) |
|---|---|---|---|
| 1.ª | 0,50% | 12.012,00 | 12.012,00 |
| 2.ª | 2,00% | 27.382,00 | **28.700,00** ⚑ deduzido |
| 3.ª | 3,00% | 70.044,00 | 70.044,00 |
| 4.ª | 8,00% | sem tecto | sem tecto |

### USC — reduzido e isenção

| Campo | 2025 | 2026 |
|---|---|---|
| Reduzida — 0,50% até | 12.012,00 | 12.012,00 |
| Reduzida — 2,00% acima disso | sem tecto | sem tecto |
| Tecto do regime reduzido | 60.000,00 | 60.000,00 |
| Isenção anual de USC | 13.000,00 | 13.000,00 |

A isenção é um **penhasco, não uma dedução**: quem passa de €13.000 paga USC
sobre o rendimento todo, a partir da primeira banda — não só sobre o excedente.

### PRSI classe A — empregado

O PRSI mudou a meio de 2025 (1 de Outubro), e por isso tem duas linhas nesse
ano. É pela **data de pagamento** que o sistema escolhe qual usar.

| Desde | Taxa | Isento até (semana) | Crédito máx. | Crédito até (semana) |
|---|---|---|---|---|
| 01/01/2025 | 4,10% | 352,00 | 12,00 | 424,00 |
| 01/10/2025 | 4,20% | 352,00 | 12,00 | 424,00 |
| 01/01/2026 | 4,20% | 352,00 | 12,00 | 424,00 |

### PRSI classe A — empregador

| Desde | Taxa inferior | Taxa superior | Limiar semanal |
|---|---|---|---|
| 01/01/2025 | 8,90% | 11,15% | 496,00 |
| 01/10/2025 | 9,00% | 11,25% | 496,00 |
| 01/01/2026 | 9,00% | 11,25% | 496,00 |

### Auto-enrolment

Não é uma tabela de um ano: é uma **escada de degraus com datas**, e cada degrau
vale da sua data em diante. Só o primeiro está cadastrado.

| Desde | Empregado | Empregador | Estado | A partir de | Tecto | Idades |
|---|---|---|---|---|---|---|
| 01/01/2026 | 1,50% | 1,50% | 0,50% | 20.000,00 | 80.000,00 | 23–60 |

**O auto-enrolment não desgrava.** Sai do líquido, depois de PAYE, USC e PRSI, e
nunca reduz a base tributável — o Estado põe o bónus por cima em vez de dar
desgravação. Tratá-lo como um PRSA desconta menos PAYE do que o devido, todas as
semanas, a toda a gente, sem dar erro nenhum. Ver a migração
`selfhost/schema/053_ae_pension.sql`.

## Como registar a conferência

1. `RH → Tax tables`, escolher o ano.
2. Corrigir o que estiver errado, em euros e por cento.
3. Escrever a **fonte** no campo do fim: que publicação, de que data.
4. Marcar **"conferida contra a Revenue"** e gravar — isso assina quem e quando.

Sem essa assinatura a marca não vale nada: seis meses depois ninguém distingue
uma conferência a sério de um clique por engano. Enquanto não estiver marcada, os
recibos saem com o aviso de tabela por confirmar, e é de propósito que incomoda.
