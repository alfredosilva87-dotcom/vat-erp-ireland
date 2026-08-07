# Leitor de Notas Fiscais — Irlanda (VAT)

App web (local primeiro) que lê notas fiscais e recibos em PDF/imagem, lista os
itens, compara a alíquota de VAT da nota com a alíquota **esperada** (base do
Revenue), destaca inconsistências e pré-sugere se cada item **gera crédito**,
conforme o objeto social da empresa.

## Estado atual (fundação)

Pronto:

- `db/schema.sql` — modelo de dados completo (Postgres/Supabase)
- `db/seed_vat_categories.sql` — base de alíquotas semeada (amostra, já com a mudança de 01/07/2026)
- `db/seed_credit_rules.sql` — regras de crédito de exemplo (inclui o caso do restaurante que compra camarão)

A construir (próximos passos): scaffold Next.js, tela de gestão da base, motor de
leitura (PDF nativo + Gemini + Tesseract) e o fluxo de análise da nota.

## Modelo de dados

| Tabela | Papel |
|---|---|
| `companies` | Empresa dona das notas. Guarda o **objeto social** (`activity_code`), que decide a sugestão de crédito. |
| `vat_categories` | A **base de alíquotas** (espelha o VAT rates database do Revenue). Mantida **manualmente** pelo contador. |
| `credit_rules` | Regras que, por atividade + categoria/palavra-chave, pré-sugerem crédito (dedutível ou não). |
| `invoices` | Cabeçalho da nota/recibo lido (fornecedor, data, totais, motor de leitura). |
| `invoice_items` | Itens: descrição, alíquota da nota vs. esperada, flag de inconsistência, decisão de crédito. |

### Flags de inconsistência (por item)

- `ok` — alíquota da nota bate com a base
- `rate_mismatch` — alíquota da nota diverge da base (destaque em vermelho)
- `no_vat_on_doc` — documento não traz VAT por item (ex.: recibo Tesco) → app estima pela base
- `unmatched` — não deu para casar a descrição com a base (revisão manual)

## Manutenção da base (papel do contador/analista)

A base de alíquotas **não** vem pronta do Revenue (a página deles é uma busca em
JavaScript, sem download nem API). Por isso a manutenção é humana:

1. Cadastrar/ajustar categorias em `vat_categories` (descrição, palavras-chave, alíquota, vigência).
2. Sempre que a lei mudar (como food/catering/cabeleireiro de 13,5% → 9% em **01/07/2026**), atualizar `effective_from`/`effective_to`.
3. Ajustar `credit_rules` conforme o objeto social dos clientes.

A tela de gestão (a construir) fará esse CRUD sem precisar mexer no SQL.

## Alíquotas VAT vigentes (Irlanda, jul/2026)

| Alíquota | Tipo | Exemplos |
|---|---|---|
| 23% | padrão | álcool, eletrônicos, refrigerante, móveis, combustível auto |
| 13,5% | reduzida | combustível doméstico, construção, limpeza |
| 9% | segunda reduzida | **alimentação/catering, cabeleireiro** (desde 01/07/2026), jornais |
| 4,8% | pecuária | gado vivo |
| 0% | zero | alimentos básicos crus, livros, roupa infantil, medicamento oral |
| — | isento | financeiro, médico, educação (sem crédito) |

> ⚠️ Software de apoio: a classificação é **sugerida e revisável**. Não substitui a análise do contador.

## Como rodar (quando o app estiver montado)

1. `npm install`
2. Copiar `.env.local.example` para `.env.local` e preencher as chaves.
3. Aplicar o schema e os seeds no Supabase (ou Postgres local).
4. `npm run dev` → http://localhost:3000

## Status — verified

The app builds cleanly (`next build` — all routes compile) and the matching
engine was unit-tested against real scenarios:

- Restaurant buying **prawns** → matched as zero-rated food, **credit suggested** (kitchen input).
- **Wine at 13.5%** on the document → flagged `rate_mismatch` (expected 23%).
- **Supermarket milk with no per-line VAT** → flagged `no_vat_on_doc`, rate estimated from base.
- **Client entertainment** → credit blocked (Irish legal rule), regardless of activity.

## Run it locally

1. `npm install`
2. `cp .env.local.example .env.local` and fill in `GEMINI_API_KEY` (Supabase keys optional to start).
3. `npm run dev` → http://localhost:3000

## Install it on a machine (self-hosted, no cloud)

For a real install — app, Postgres and file storage all on the same computer,
Windows or Mac — use the packaged installer instead of the steps above:

- Guide: [`selfhost/README.md`](selfhost/README.md)
- Test checklist: [`selfhost/TESTE.md`](selfhost/TESTE.md)

Double-click `selfhost/install.bat` (Windows) or `selfhost/install.command`
(Mac). It brings up the Supabase stack in Docker, applies the schema and the
reference base, creates the admin account and builds the app.

Without Supabase the app uses the **bundled base** (read-only) so you can test reading
immediately with only a Gemini key. With Supabase configured, apply `db/schema.sql` +
the two seed files and the Rate base screen becomes editable.

## Known limitations (next iterations)

- **History gap in the seed:** the seeded `CATERING`/`HAIRDRESS` rows are valid only from
  01/07/2026 (the 9% change). Invoices *before* that date currently show as `unmatched`
  for catering — the accountant should add the historical 13.5% rows with
  `effective_to = 2026-06-30`. The engine already picks the rate valid on the invoice date.
- **Credit-rule editing** is not yet in the UI (rules are shown read-only); category editing is live.
- The bundled base is a representative sample, **not** the full Revenue catalogue.
