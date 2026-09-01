# Tradução pendente — inventário por rota

Auditoria feita em 2026-09-01 contra `https://vat-erp-ireland.vercel.app`, com a
interface posta em **Português** (`/settings` → Idioma → Português), percorrendo
as rotas uma a uma e cruzando cada string vista na tela com o código-fonte.

## Como ler

Cada achado tem um **tipo de defeito**:

- **(a) literal fixo no JSX** — a string está escrita à mão no componente, sem
  passar por `t()`. Aparece em inglês em TODOS os idiomas, inclusive quando o
  utilizador escolhe Português. **É o único tipo que existe neste projeto.**
- **(b) chave presente em `en.ts` e ausente de `pt.ts`** — **ZERO ocorrências.**
  Verificado por extração de chaves dos dois ficheiros:

  ```
  lib/i18n/en.ts   1497 chaves
  lib/i18n/pt.ts   1497 chaves
  en \ pt          (vazio)
  pt \ en          (vazio)
  ```

  O dicionário português está **completo e em paridade exata** com o inglês.
  Tudo o que aparece em inglês na tela com o idioma em PT é, sem exceção,
  literal fixo no código.

Há ainda um espelho do mesmo defeito: **literais fixos em português**, que
quebram o inglês/espanhol/polaco/romeno. Estão listados numa secção à parte
porque se corrigem no mesmo passe, ficheiro a ficheiro.

---

## 1. Resumo por rota — pior primeiro

| # | Rota | Itens em inglês | Ficheiro(s) principais |
|---|------|----------------:|------------------------|
| 1 | `/invoice/[id]` (detalhe da nota, aberto a partir de `/records` e `/purchases`) | **51** | `app/invoice/[id]/page.tsx` |
| 2 | `/base` (Base de alíquotas — nav *Base de dados → Base de alíquotas*) | **44** | `app/base/page.tsx`, `components/CreditRulesManager.tsx` |
| 3 | `/clients` | **29** | `app/clients/page.tsx` |
| 4 | `/clients/[id]/accounting` (abas DRE, Balanço, Comparativo) | **25** | `lib/accounting/reports.ts`, `lib/accounting/comparative.ts` |
| 5 | `/clients/[id]/bright` | **19** | `app/clients/[id]/bright/page.tsx` |
| 6 | `/clients/[id]/vat` | **18** | `app/clients/[id]/vat/page.tsx` |
| 7 | `/settings` | **16** | `app/settings/page.tsx`, `components/settings/FirmCard.tsx` |
| 8 | `/items` | **14** | `app/items/page.tsx` |
| 9 | `/` (painel do escritório) | **13** | `app/page.tsx` |
| 10 | `/clients/[id]/obligations` | **12** | `app/clients/[id]/obligations/page.tsx` |
| 11 | `/clients/[id]/settings` | **9** | `app/clients/[id]/settings/page.tsx` |
| 12 | `/clients/[id]/dashboard` | **7** | `app/clients/[id]/dashboard/page.tsx`, `components/MiniBars.tsx` (+4) |
| 13 | `/` (cartões de cliente, quando há clientes) | **7** | `components/ClientsOverview.tsx` |
| 14 | `/records` | **6** | `app/records/page.tsx` |
| 15 | `/clients/[id]/purchases` | **4** | `app/clients/[id]/purchases/page.tsx` |
| 16 | qualquer rota que rebente (`error.tsx`) | **4** | `app/error.tsx` |
| 17 | `/master`, `/master/licenses` | **4** | `app/master/page.tsx`, `app/master/licenses/page.tsx` |
| 18 | `/clients/[id]/invoices/[invoiceId]` | **2** | `app/clients/[id]/invoices/[invoiceId]/page.tsx` |
| 19 | `/clients/[id]/bank` | **1** | `app/clients/[id]/bank/page.tsx` |
| 20 | `/analyze`, `/clients/[id]/analyze` | **1** | `components/AnalyzeView.tsx` |
| 21 | `<head>` de todas as páginas (meta description) | **1** | `app/layout.tsx` |
| — | **TOTAL** | **≈ 287** | 21 ficheiros |

Rotas verificadas **sem nenhum inglês**: `/inbox`, `/obligations`, `/search`,
`/settings/users`, `/settings/permissions`, `/settings/profile`,
`/clients/[id]/sales`, `/clients/[id]/invoices`, `/clients/[id]/customers`,
`/clients/[id]/suppliers`, `/clients/[id]/payable`, `/clients/[id]/receivable`,
`/clients/[id]/accounts`, `/clients/[id]/ledger`, `/clients/[id]/checkup`,
`/clients/[id]/documents`, `/clients/[id]/branches`, `/clients/[id]/mail`,
`/clients/[id]/accounting` abas *Balancete*, *VAT*, *Imposto*, *Fecho*.

`/clients/[id]/unposted` **não renderiza nada** na produção (página em branco,
sem texto no `<main>`). Não é defeito de tradução, mas fica registado porque
impediu a verificação dessa rota.

---

## 2. Achados por ficheiro

Agrupados por ficheiro para se poder corrigir um ficheiro inteiro de uma vez.
Todos os achados são do **tipo (a)** — literal fixo no JSX.

### `app/invoice/[id]/page.tsx` — 51 itens (rota `/invoice/[id]`)

O maior ofensor do projeto. O ficheiro já importa `t()` (17 chamadas), mas o
formulário inteiro do documento ficou de fora.

| Linha | String |
|------:|--------|
| 274 | `Loading…` |
| 275 | `Invoice not found.` |
| 275 | `Back` |
| 284 | `Edit invoice` |
| 291 | `View document` |
| 293 | `Delete` |
| 347 | `Needs review — the automated read wasn't fully confident` |
| 397 | `Document details` |
| 399 | `Supplier` (label) |
| 400 | `Store / branch` (label) · `e.g. Shrewsbury` (placeholder) |
| 401 | `VAT number` (label) |
| 402 | `Document no.` (label) |
| 403 | `Issue date` (label) |
| 404 | `Posting date` (label) |
| 405 | `Time` (label) · `HH:MM` (placeholder) |
| 406 | `Barcode / reference` (label) |
| 407 | `Type` (label) |
| 409–411 | `Invoice` · `Receipt` · `Other` |
| 415 | `Branch / loja` (label — meio inglês, meio português) |
| 417 | `No branch` |
| 425–427 | `Net €` · `VAT €` · `Gross €` (labels) |
| 436 | `+ Add item` · title `e.g. a page/item missing from the read — enter the amount as printed and pick a category` |
| 437–438 | `Credit all` · `Uncredit all` |
| 447–456 | cabeçalhos da tabela de itens: `Item`, `Category`, `Account`, `Rate %`, `VAT %`, `Amount €`, `Gross €`, `Net €`, `Credit €`, `Credit` |
| 450 | title `Base rate %` |
| 451 | title `VAT doc %` |
| 452 | title `The amount as printed on the document — net or VAT-inclusive gross, depending on how the supplier prints it.` |
| 467 | title `This item` |
| 475 | `— uncategorised —` |
| 486 | `— no account —` |
| 492 | `no chart` |
| 518 | title `Remove this line` |
| 547–551 | parágrafo `…category, base rate, the rate on the document, the amount, and the credit decision. Amount is the … and the client balance.` |

### `app/base/page.tsx` — 22 itens (rota `/base`)

| Linha | String |
|------:|--------|
| 8–13 | rótulos das alíquotas: `Standard 23%`, `Reduced 13.5%`, `Second reduced 9%`, `Livestock 4.8%`, `Zero 0%`, `Exempt` |
| 89 | `Rate base` (título da página) |
| 91–92 | parágrafo `The VAT rate catalogue that drives the checks. Maintained by the accountant — Revenue does not publish a downloadable database, so rates are kept current here.` |
| 102 | `Read-only (bundled base).` |
| 112 | `Add a category` |
| 115 | `Description` |
| 120 | placeholder `e.g. Restaurant / catering services` |
| 124 | `Rate` |
| 141 | `Effective from` |
| 150 | `Keywords (comma-separated, used for item matching)` |
| 155 | placeholder `restaurant, catering, hot food, takeaway` |
| 172 | placeholder `Search categories or keywords…` |
| 185–188 | cabeçalhos: `Category`, `Keywords`, `Rate`, `Effective` |

### `components/CreditRulesManager.tsx` — 22 itens (renderizado em `/base`)

| Linha | String |
|------:|--------|
| 7 | `Any activity` |
| 53 | `Credit rules` |
| 55–56 | parágrafo `Per company type, decide what gives input credit. Rules are matched by keyword, lowest priority first. The generic "Any activity" rules apply to everyone.` |
| 60 | `All activities` |
| 69 | `Activity` |
| 75 | `Keywords (comma)` |
| 76 | placeholder `prawn, fish, oil` |
| 79 | `Priority` |
| 83 | `Credit` |
| 85–86 | `Deductible` · `Not deductible` |
| 90 | `Add` |
| 94 | placeholder `Rationale (why this is / isn't deductible)` |
| 105–109 | cabeçalhos: `Activity`, `Keywords`, `Priority`, `Credit`, `Rationale` |
| 133–134 | `Deductible` · `Not deductible` |
| 141 | `Delete` |

### `app/clients/page.tsx` — 29 itens (rota `/clients`)

| Linha | String |
|------:|--------|
| 105 | `Clients` (título) |
| 107 | `Register the companies you manage. Selecting a client scopes every screen to it.` |
| 134 | `Company name *` (label) |
| 137 | `Client code (optional, auto)` (label) · 138 placeholder `auto` |
| 140 | `Company type` (label) |
| 147 | `VAT number` (label) |
| 150 | `Tax Registration No (Revenue)` (label) |
| 153 | `Email` (label) |
| 156 | `Phone` (label) |
| 159 | `Address` (label) |
| 162 | `Notes` (label) |
| 167 | `Categories this client sells / uses` |
| 169–171 | `Optional. Once you pick at least one, an item on a purchase invoice whose category isn't in this list gets flagged "verify" on the item line and on the invoice. Leave empty to keep this check off (default).` |
| 185 | `Loading categories…` |
| 198 | `Auto-approve credit for unmatched items` |
| 218–224 | cabeçalhos: `Code`, `Company`, `Type`, `VAT / TRN`, `Invoices`, `Credit €`, `Actions` |
| 244–251 | `Open`, `Selected`, `Select`, `Edit`, `Delete` |
| 259 | `No clients yet. Click "New client" to register the first company.` |

### `lib/accounting/reports.ts` — 21 itens (aba **DRE** e **Balanço** de `/clients/[id]/accounting`)

Estes rótulos são gerados no servidor e chegam à tela dentro do payload, por
isso não se resolvem com `t()` no componente — precisam de virar chaves e ser
traduzidos no lado do cliente (ou o `label` passar a ser uma `TKey`).

Confirmado na tela: a aba DRE mostrava `Turnover / Cost of sales / Gross profit
/ Administrative expenses / Operating profit / Profit before taxation / Profit
for the financial year` com o resto da página em português.

| Linha | String |
|------:|--------|
| 70 | `Turnover` |
| 71 | `Cost of sales` |
| 72 | `Gross profit` |
| 73 | `Other operating income` |
| 74 | `Distribution costs` |
| 75 | `Administrative expenses` |
| 76 | `Operating profit` |
| 77 | `Interest and similar charges` |
| 78 | `Profit before taxation` |
| 79 | `Tax on profit` |
| 80 | `Profit for the financial year` |
| 141 | `Fixed assets` |
| 142–144 | `Intangible assets`, `Tangible assets`, `Financial assets` |
| 146–149 | `Current assets`, `Stocks`, `Debtors`, `Cash at bank and in hand` |
| 151 | `Creditors: amounts falling due within one year` |
| 152–153 | `Net current assets`, `Total assets less current liabilities` |
| 154 | `Creditors: amounts falling due after more than one year` |
| 155–156 | `Provisions for liabilities`, `Net assets` |
| 158–161 | `Called up share capital`, `Other reserves`, `Profit and loss account`, `Capital and reserves` |

> **Nota de decisão:** estas são as legendas estatutárias do *Schedule 3A* do
> Companies Act 2014 e é defensável mantê-las em inglês **no PDF entregue à
> Revenue/CRO**. Na tela, porém, deviam seguir o idioma. Recomenda-se separar:
> chave traduzida para o ecrã, string estatutária fixa para o export.

### `lib/accounting/comparative.ts` — 4 itens (visão *Completa*)

| Linha | String |
|------:|--------|
| 104 | `Turnover` |
| 109 | `Gross profit` |
| 114 | `Profit for the year` |
| 130 | `Net margin` |

### `app/clients/[id]/bright/page.tsx` — 19 itens (rota `/clients/[id]/bright`)

Página **inteiramente** em inglês. Só 2 chamadas a `t()` no ficheiro todo.

| Linha | String |
|------:|--------|
| 29 | `Contacts (CSV)` + `Suppliers from invoices + customers from sales. Import in Data Import → Contacts.` |
| 30 | `Supplier Invoices — Detailed (CSV)` + `One line per item, with nominal code (chart of accounts) and VAT. Import in Data Import → Supplier Invoices.` |
| 31 | `Journal (CSV)` + `Double-entry lines per invoice (Dr expense + Dr VAT / Cr Accounts Payable). Import in Data Import → Journals.` |
| 38 | `Bright / BrightBooks` |
| 40–41 | `Two ways to integrate with BrightBooks (Surf Accounts): CSV export … and API connection …` |
| 45 | `Year` |
| 57–58 | `Route 1 · CSV export` · `Available` |
| 61–64 | `Download the file and import it into BrightBooks under Data Import. Column headers are provisional and live in a single spot in the code (lib/brightExport.ts → COLS) — once you get the official Surf template, we'll match it 1:1.` |
| 70 | `Download CSV` |
| 79 | `Route 2 · API connection` |
| 81 | `Connected` / `Unavailable` |
| 86 | `Checking connection status…` |
| 89 | `The Surf/BrightBooks API isn't public — access is granted case by case by Bright (partner-gated).` |
| 90–91 | `The plumbing is already in place: … Once Bright grants credentials, we apply … and implement the TODOs in …` |
| 93 | title `Requires Bright partner access` |
| 94 | `Send via API (unavailable)` |

### `app/clients/[id]/vat/page.tsx` — 18 itens (rota `/clients/[id]/vat`)

| Linha | String |
|------:|--------|
| 14–20 | seletor de período: `Full year`, `Jan–Feb`, `Mar–Apr`, `May–Jun`, `Jul–Aug`, `Sep–Oct`, `Nov–Dec` |
| 62 | `VAT by rate` (título) |
| 72–73 | `Export Excel` · `Export PDF` |
| 78 | `Loading…` |
| 91 | `Record` |
| 104–107 | cabeçalhos: `Rate`, `Net €`, `VAT €`, `Docs` |
| 112 | `No data in this period.` |
| 143 | `Total` |

(Na mesma rota, `components/DonutChart.tsx:98` também tem `No data in this period.`)

### `app/settings/page.tsx` — 6 itens (rota `/settings`, bloco *Licence*)

| Linha | String |
|------:|--------|
| 50 | `Licence activated — valid until {data}.` (mensagem de retorno) |
| 166 | `Licence` (título da secção) |
| 184 | `valid until` |
| 188 | `signed key` |
| 196–197 | `Got a renewal key by e-mail? Paste it here. The system checks its signature on the spot — it needs no internet connection and nobody has to sign in to this installation.` |
| 201 | placeholder `VATERP1.…` |
| 213–215 | `The key names the company it was issued for and the date it runs to, and it is signed. A key for another company, one that has expired, or one that would shorten the current licence is refused, and nothing changes.` |

Também aparece `Activate` (linha ~208) e o chip de estado (`valid`).

### `components/settings/FirmCard.tsx` — 10 itens (renderizado em `/settings`)

Só 1 chamada a `t()` no ficheiro.

| Linha | String |
|------:|--------|
| 29–36 | labels: `Firm name`, `Professional registration`, `Address`, `Phone`, `E-mail`, `Website`, `Signed by`, `Title` |
| 81 | `Firm details` (título) |
| 106 | `On the report` |

Ainda no mesmo cartão, vistos na tela e a confirmar linha exata:
`Printed on the balance sheet, profit and loss and trial balance you hand to
clients. Anything left blank is simply left off the page.`,
`CPA / ACCA / CAI number of whoever signs`, `Printed under the signature line`,
`Save`.

### `app/items/page.tsx` — 14 itens (rota `/items`)

| Linha | String |
|------:|--------|
| 70 | `Items catalogue` |
| 72–73 | `Every item ever read from invoices, de-duplicated. Edits here feed the learning cache, so future reads reuse your corrections — no AI call, no cost.` |
| 89 | placeholder `Search items or categories…` |
| 90 | `Search` |
| 92 | `Clear` |
| 101–105 | cabeçalhos: `Item name`, `Category`, `Base rate %`, `Seen`, `Actions` |
| 116 | `— uncategorised —` |
| 142 | `Delete` |
| 150 | `No items yet — analyze and save an invoice first.` |

### `app/page.tsx` — 13 itens (rota `/`)

O cartão *Alíquotas de VAT vigentes na Irlanda* tem o título em PT e o conteúdo
todo em inglês.

| Linha | String |
|------:|--------|
| 9 | `Standard` + `Alcohol, electronics, soft drinks, furniture, auto fuel` |
| 10 | `Reduced` + `Domestic fuel, construction, cleaning services` |
| 11 | `Second reduced` + `Food & catering, hairdressing (since 01 Jul 2026), newspapers` |
| 12 | `Livestock` + `Live cattle, sheep, horses, greyhounds` |
| 13 | `Zero` + `Basic raw food, books, children's clothing, oral medicine` |
| 14 | `Exempt` + `Financial, medical, education (no credit)` |
| 41–42 | `Effective July 2026. The base is history-aware, so older invoices are checked against the rate valid on their date.` |

### `app/clients/[id]/obligations/page.tsx` — 12 itens

O ficheiro tem 31 chamadas a `t()`; o bloco VAT3/RTD ficou de fora.

| Linha | String |
|------:|--------|
| 115 | `Tax obligations {ano}` |
| 117 | `Bi-monthly VAT3 returns (due the 23rd of the following month) and the annual RTD. T2 (VAT on purchases) is auto-filled from this client's invoices; enter T1 (VAT on sales) to get T3, the net position.` |
| 128 | `Refresh from invoices` / `Refreshing…` |
| 137–142 | cabeçalhos: `Return`, `Period`, `Due`, `T1 · VAT sales`, `T2 · VAT purchases`, `T3 · Net` |
| 173 | `overdue` |
| 232 | `No obligations generated for {ano} yet.` |
| 240 | `T3 > 0 = payable to Revenue; T3 < 0 = repayable. The RTD is informational (no payment).` |

### `app/clients/[id]/settings/page.tsx` — 9 itens

| Linha | String |
|------:|--------|
| 25–32 | opções de *Tipo de negócio*: `Generic business`, `Restaurant / catering`, `Retail / shop`, `Construction`, `Transport / haulage`, `Professional services`, `Beauty / hairdressing`, `Farming / agriculture` |
| 207 | placeholder `IE1234567X` (exemplo de formato — pode ficar) |

### `app/clients/[id]/dashboard/page.tsx` — 7 itens

O ficheiro tem 56 chamadas a `t()`; só a tabela *Resumo por taxa de VAT* escapou.

| Linha | String |
|------:|--------|
| 66 | `Could not load the dashboard.` |
| 238–243 | cabeçalhos: `Rate`, `Net sales €`, `VAT sales (T1) €`, `Net purchases €`, `Credit (T2) €`, `Net (T3) €` |

### `components/MiniBars.tsx` — 4 itens (gráfico do painel do cliente)

| Linha | String |
|------:|--------|
| 42 | aria-label `Monthly purchases and sales` |
| 113–115 | legendas: `Purchases in (gross)`, `Input credit`, `Sales out (gross)` |

### `components/ClientsOverview.tsx` — 7 itens (rota `/`)

Ficheiro com 3 chamadas a `t()`.

| Linha | String |
|------:|--------|
| 29 | `Clients` |
| 30 | `Registered companies and their balances.` |
| 33 | `Total credit €` |
| 34 | `Manage clients` |
| 51 | `Select` |
| 57–59 | `Invoices`, `Gross €`, `Credit €` |
| 67 | `Register your first company →` |

### `app/records/page.tsx` — 6 itens (rota `/records`, aba *Itens únicos*)

| Linha | String |
|------:|--------|
| 161 | `Show all invoices` |
| 387–390 | cabeçalhos: `Item (canonical)`, `Category`, `Base rate`, `Times seen` |
| 398 | `Uncategorised` |
| 409 | `No items yet.` |

### `app/clients/[id]/purchases/page.tsx` — 4 itens

| Linha | String |
|------:|--------|
| 336 | title `Net / gross by VAT rate` |
| 388 | `Loading…` |
| 392 | `Gross total` |
| 396 | `VAT total` |

### `app/error.tsx` — 4 itens (ecrã de erro global)

| Linha | String |
|------:|--------|
| 17 | `Something went wrong` |
| 19 | `An unexpected error happened. You can try again, or head back to sign in.` |
| 22 | `Try again` |
| 23 | `Go to sign in` |

### `app/master/page.tsx` — 9 itens (rota `/master`)

| Linha | String |
|------:|--------|
| 13–20 | rótulos do histórico: `Company created`, `Renewed by master`, `Key regenerated`, `Renewal generated`, `Activated by admin`, `Activated with a signed key` |
| 169 | `Renewal key generated` |
| 171 | `Hand this key to the company's admin — they activate it themselves from Settings.` |
| 252 | `Loading…` |
| 269 | `No history yet for this company.` |

### Ficheiros com 1–2 itens

| Ficheiro | Linha | String |
|----------|------:|--------|
| `app/layout.tsx` | 16 | meta description `Read invoices, check Irish VAT, manage clients, credits and records.` |
| `app/clients/[id]/invoices/[invoiceId]/page.tsx` | 351 | placeholder `Consulting services` |
| `app/clients/[id]/bank/page.tsx` | 96 | placeholder `IBAN / final` |
| `components/AnalyzeView.tsx` | 264 | `Branch / loja` (metade inglês) |
| `components/AnalyzeView.tsx` | 286 | `PDF, PNG, JPEG, WebP` (aceitável — nomes de formato) |
| `app/master/licenses/page.tsx` | 161 | placeholder `Precise Tax and Accounting Solutions` |
| `components/DonutChart.tsx` | 98 | `No data in this period.` |

---

## 3. Onde começar — ficheiros com mais literais fixos

Corrigir estes cinco resolve **mais de metade** do inventário:

| # | Ficheiro | Literais | Porquê primeiro |
|---|----------|---------:|-----------------|
| 1 | `app/invoice/[id]/page.tsx` | **51** | É o ecrã mais usado do fluxo de conferência e o pior do projeto. Já importa `t()` — falta só o formulário e a tabela de itens. |
| 2 | `components/CreditRulesManager.tsx` + `app/base/page.tsx` | **44** | Os dois compõem a rota `/base` inteira. São tabelas e formulários curtos, sem lógica — o passe mais rápido por item corrigido. |
| 3 | `app/clients/page.tsx` | **29** | Primeira tela depois do login para quem gere carteira. Rótulos de formulário e cabeçalhos, todos triviais. |
| 4 | `lib/accounting/reports.ts` | **21** | Aparece em DRE, Balanço, PDF e Excel de uma vez. Exige decidir antes: legenda estatutária no export vs. rótulo traduzido no ecrã. |
| 5 | `app/clients/[id]/bright/page.tsx` | **19** | Página 100% inglesa, sem nenhum `t()` real. Corrige-se de uma assentada, sem risco. |

Logo a seguir, com bom retorno pelo esforço:
`app/clients/[id]/vat/page.tsx` (18), `app/items/page.tsx` (14),
`components/settings/FirmCard.tsx` (10, e só 1 `t()` no ficheiro inteiro).

---

## 4. Espanhol — tamanho do trabalho

**Correção à premissa da auditoria:** `lib/i18n/es.ts` **já existe** no `main`,
criado no commit `a980423` ("Espanhol entra a meio, e a meio já serve"). O
`index.tsx` já o regista (`const DICTS = { en, pt, es }`). Não está no worktree
`claude/analise-lotes-contabeis-c66b4f`, que é mais antigo.

Contagem exata de chaves:

| Ficheiro | Chaves | Cobertura |
|----------|-------:|----------:|
| `lib/i18n/en.ts` (referência, define `TKey`) | **1497** | 100% |
| `lib/i18n/pt.ts` | **1497** | **100%** |
| `lib/i18n/es.ts` | **151** | **10,1%** |

**Faltam 1346 chaves para o espanhol.** Como `index.tsx` resolve chave a chave
contra o inglês (`DICTS[lang]?.[key] ?? en[key] ?? key`), essas 1346 aparecem em
inglês para quem escolhe Español — nunca em branco.

Polaco (`pl`) e romeno (`ro`) continuam **sem dicionário nenhum**: `LANGS` em
`lib/i18n/languages.ts` lista-os com `complete: false`, mas não há `pl.ts` nem
`ro.ts`. São **1497 chaves cada**, ou seja 100% em inglês.

Total para completar os três idiomas parciais: **1346 + 1497 + 1497 = 4340
traduções**.

---

## 5. Espelho do defeito — literais fixos em PORTUGUÊS

Aparecem em português para quem escolhe English/Español/Polski/Română. Mesmo
tipo de defeito (a), mesmo passe de correção, sentido inverso.

| Ficheiro | Linhas | Exemplos |
|----------|--------|----------|
| `components/StatementImport.tsx` | 28, 30, 33, 210, 242, 272, 288, 337–340 | `Data`, `Valor`, `Saldo`, `Importar extrato`, `Cancelar`, `Sinal`, `— nenhuma —` |
| `components/financial/TitlesView.tsx` | 123, 150–157, 186–189, 211–216, 260 | `procurar…`, `Original`, `Encargos`, `Pago`, `Vencido`, `Vencimento`, `Documento`, `Anterior` |
| `components/BankRuleCard.tsx` | 18, 108, 134, 144, 149, 158, 161, 178–181 | `Valor`, `Casar quando`, `Remover`, `Destino`, `— conta —`, `€ fixo`, `Salvar`, `Cancelar`, `Apagar regra` |
| `app/clients/[id]/bank/[accountId]/*` (4 páginas) | várias | `Carregando…`, `Conta`, `Data`, `Valor €`, `Saldo €`, `Conciliar`, `Desconciliar`, `Refazer`, `Reabrir`, `Fechamentos anteriores`, `Extrato €`, `Informado €` |
| `app/clients/[id]/sales/[saleId]/page.tsx` | 118–246 | `Carregando…`, `Voltar`, `Conferir venda`, `Excluir`, `Conferida`, `Desfazer`, `Conferi — aprovar`, `← Anterior`, `Data *`, `Cliente (comprador)`, `IVA €`, `Linhas`, `Qtd` |
| `components/SalesEntryDialog.tsx` | 80, 196–199, 212, 281–286 | `Nenhuma linha reconhecida no texto colado.`, `Digitar`, `Excel / CSV`, `Colar`, `Foto (IA)`, `Fechar`, `Data *`, `Documento`, `Cliente`, `IVA €` |
| `app/charges/page.tsx` | 96–178 | página inteira: `Encargos e baixas`, `Tipo`, `Efeito`, `Ativo`, `Novo tipo`, `Chave`, `Nome`, `Conta — a pagar`, `Conta — a receber`, `Criar` |
| `app/chart/page.tsx` | 120–182 | `Natureza`, `Rubrica`, `Ativa`, `Nada encontrado.` |
| `app/console/page.tsx` | 152–300 | página inteira em PT |
| `app/master/licenses/page.tsx` | 111–235 | `Empresas`, `Emitir`, `Meses`, `Emitidas`, `Emitida`, `Empresa`, `Slug`, `Nada emitido ainda.` |
| `components/ClientBranches.tsx` | 59–99 | `Filiais / lojas`, `Nova filial`, `Adicionar`, `Carregando…`, `Nome`, `Apagar` |
| `components/financial/IntegrationTrace.tsx` | 94–238 | `contabilizada`, `Conta`, `soma`, `Contabilizar`, `Vencimento`, `Original`, `Pago` |
| `components/financial/NovoTituloManual.tsx` | 133–195 | `Documento`, `opcional`, `Vencimento`, `Cancelar` |
| `components/SplitSettlement.tsx` | 105–188 | `Dividir esta linha entre documentos`, `aplicado`, `Cancelar` |
| `components/ReconcileRow.tsx` | 109 | `Voltar` |
| `components/ScreenSkeleton.tsx` | 20 | `A carregar…` (sr-only) |
| `components/fiscal/QuadroDeObrigacoes.tsx` | 124, 165 | `Cliente`, `A entregar` |
| `app/clients/[id]/accounts/page.tsx` | 87–176 | `Contas próprias deste cliente`, `procurar…`, `abra o plano geral`, e três parágrafos |
| `app/clients/[id]/bank/rules/page.tsx` | 67–141 | `Salva.`, `sugere`, `Nova regra`, `Criar`, `Carregando…`, e três parágrafos |

---

## 6. Não é `t()` — mas aparece em inglês na tela

Três fontes de texto inglês que **não se resolvem com o dicionário** e precisam
de decisão à parte:

1. **Plano de contas (dados do banco).** A aba *Balancete* e os seletores de
   conta do painel de imposto mostram `Sales`, `Purchases`, `Entertaining`,
   `Insurance`, `Light and heat`, `Purchase ledger control`, `Corporation tax
   payable`, etc. Vêm de `selfhost/schema/037_plano_da_pratica.sql` e
   `db/seed_supabase.sql`. São nomes contabilísticos irlandeses — provavelmente
   para ficar, mas é uma escolha a assumir.

2. **Catálogo de categorias de VAT (dados do banco).** As 41 caixas em
   *Categorias que este cliente vende / usa* (`Meat & poultry (raw)`,
   `Savoury snacks`, `Children's clothing & footwear`…) vêm de
   `selfhost/schema/002_seed_reference_data.sql` e `lib/fallbackBase.ts`.
   Traduzir exige coluna de descrição por idioma na tabela de categorias.

3. **Rótulos de período das obrigações, gravados em inglês.**
   `lib/fiscal/calendario.ts` escreve o `periodLabel` no banco no momento em que
   gera a obrigação: linha 125 `Jan–Feb 2026`, 133 `RTD 2026`, 168 `Form 11
   2026`, 174 `Preliminary tax 2027`, 191 `CT1 2026`, 205 `Preliminary CT
   2026`, 217 `Annual Return 2026`. Confirmado na tela do painel do cliente
   (`Obrigações próximas`). Como fica persistido, mudar o idioma depois não os
   corrige — tem de virar chave + argumentos, renderizada na leitura.

4. **Datas e números sempre em `en-IE`.** 25 ficheiros chamam
   `toLocaleString("en-IE", …)` / `toLocaleDateString` com locale fixo, em vez
   de usar `lang` do contexto. Consequência visível: os meses do gráfico
   *Faturamento × Compras* saem `Jan Feb Mar Apr May …` mesmo em português
   (`lib/store.ts:635`, `lib/fiscal/calendario.ts:59`, `lib/hr/payroll.ts:219`
   têm arrays de meses em inglês fixos). O dicionário até já tem `close.m1…m12`
   traduzidos — só não são usados aqui.

---

## 7. Não confirmados

Vistos na tela mas sem localização exata fixada no código (a confirmar antes de
corrigir):

- `/settings`, cartão *Firm details*: `Printed on the balance sheet, profit and
  loss and trial balance you hand to clients. Anything left blank is simply left
  off the page.`, `CPA / ACCA / CAI number of whoever signs`, `Printed under the
  signature line`, `Save`. Estão em `components/settings/FirmCard.tsx`, mas as
  linhas exactas não foram fixadas.
- `/settings`, chip de estado da licença: `valid` / `valid until 2028-08-02 (701
  days)` — a parte `(701 days)` vem provavelmente de `components/LicenseGate.tsx`.
- `/clients/[id]/accounting`, aba *Abertura*: não foi possível abrir a aba na
  produção (o clique não trocou o painel). Conteúdo por auditar.
- `/clients/[id]/unposted`: página em branco na produção. Por auditar.
- `/clients/[id]/branches` e `/clients/[id]/mail`: renderizaram sem conteúdo no
  `<main>` (o conteúdo vive dentro de `/clients/[id]/settings`, que foi
  auditado). Por confirmar se são rotas vivas.
- `/hr/*` (Recursos Humanos) e `/enviar/[token]` não constavam do âmbito pedido
  e não foram percorridos.
