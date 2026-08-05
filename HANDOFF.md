# VAT ERP Ireland — Handoff / Estado do Projeto

> Documento para continuar o projeto em outra máquina (Mac). Gerado em 2026-07-30.
> Cole este arquivo no início da nova sessão do Claude para retomar o contexto.

## O que é o projeto

Aplicativo web (ERP contábil) para **VAT da Irlanda**. Lê notas fiscais (PDF/imagem), extrai os itens, faz o **de-para** com a base do Revenue (itens + alíquotas), sinaliza inconsistências de alíquota/descrição com destaque visual, e permite decidir **tomar crédito ou não**. Referência de modelo: SPED Fiscal / Contribuições do Brasil, adaptado à base atualizada do Revenue irlandês.

## Stack

- **Next.js 14.2.35** (App Router) + React 18 + TypeScript + Tailwind
- **Supabase** (Postgres + Storage) — persistência e bucket de documentos
- **Auth**: bcryptjs + jose (cookie JWT), protegido por `middleware.ts`
- **Extração**: Google Gemini (`@google/generative-ai`), `pdf-parse` (PDF nativo), Tesseract (OCR fallback)
- **Excel**: `xlsx` (SheetJS) para import/export
- Deploy: **Vercel**

## Infra (onde está tudo)

- **GitHub**: `https://github.com/alfredosilva87-dotcom/vat-erp-ireland.git` (branch `main`)
  - Status: **tudo commitado e enviado** (main == origin/main, nada pendente). Tag existente: `v0-local`.
- **Supabase**: org `alfredosilva87-dotcom`, ref `qimcehiwxalhvbcpyzvg`, região eu-central-1
  - URL: `https://qimcehiwxalhvbcpyzvg.supabase.co`
  - Schema `erp_initial_schema` aplicado. RLS ligado (deny-by-default; app usa service role no servidor).
  - Bucket de Storage: `documents`
- **Produção (Vercel)**: `https://vat-erp-ireland.vercel.app/`
  - Login admin: `alfredo.silvajr87@gmail.com` (senha **não** versionada — está no gerenciador de senhas / painel da Vercel)
  - Env vars já configuradas: `AUTH_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`

## Histórico de versões (git log)

| Versão | Descrição |
|--------|-----------|
| v0 | ERP local (VAT reader Ireland) — ponto de partida (store em JSON local) |
| — | Migração do store para Supabase + Storage; auth e login |
| — | Data de lançamento (`posting_date`) separada da emissão; obrigações e gráficos por competência |
| v0.3 | Plano de contas por cliente (CRUD + import Excel/CSV); seletor de conta por item; de-para item→conta |
| v0.3+v0.4 | Plano de contas por cliente + import Excel; UX: coluna data lançamento, voltar ao cliente, campos/botões menores |
| v0.5 | VAT por alíquota (entradas/saídas) com drill-down; export Excel multi-aba e PDF (print) |
| v0.6 | Filiais/lojas por cliente: cadastro, seleção no import e na nota, coluna e filtro na Database, branch no export |
| v0.7 | Upload de vendas por arquivo (Excel/CSV/TXT/extrato) com detecção de colunas, carrega na grade para revisão |
| v0.8 | Ponte Bright/BrightBooks (CSV export + API stub) |
| v0.9 | Confiabilidade da leitura (score real + escalonamento p/ visão + needs_review) e crédito por categoria de negócio (11 atividades + default por cliente) |
| v1.0 | Identidade roxo/escuro + tema claro, sub-painel do cliente com abas, menu retrátil, gráfico entradas×saídas, import paralelo |
| v1.1 | Dashboard fiscal auto-alimentado (KPIs T1/T2/T3, linha, rosca, obrigações próximas) e Excel estilizado com ExcelJS |
| v1.2 | Exportação Excel/CSV/PDF com seleção de período e de quais dados; filtros de data e revisão na Database |
| v1.3 | Idiomas EN/PT completos (5 no seletor), Configurações, contas de usuário e permissões por perfil |
| v1.4 | Aba Compras (T2) por cliente e exclusão em lote |
| v1.5 | Multi-empresa: login por empresa, isolamento de dados e painel master com licença anual |
| v1.6 | Corrige VAT de recibos com preço já com imposto embutido (extração vs. soma) e regras de item bloqueado (combustível/consumo próprio) |
| v1.7 | Recuperação de senha por e-mail (via Supabase Auth), alerta de licença a 30 dias (banner) e exportação Sage 50 (Vendas + Contatos) |
| v1.8 | Detecção de duplicidade no lançamento (aviso + salvar mesmo assim), correção de crédito zerado quando só há preço unitário, redirecionamento pós-salvar/excluir para a tela de origem, licença self-service por chave, exports em inglês |
| v1.9 | Importação em lote não salva mais sem filial/loja selecionada (evita nota órfã) e permite descartar duplicata individualmente; recuperação de senha resiliente a redirect mal configurado no Supabase; revisão automática quando item creditado tem alíquota não resolvida, contradiz a nota, ou veio de match fraco de keyword — fecha o ciclo com o aprendizado já existente em `items_master` |
| v1.10 | Logo/favicon reais (substitui o "V" digitado), app instalável como PWA no desktop (manifest + ícones, sem service worker de propósito — dado financeiro não deve parecer disponível offline); corrige middleware bloqueando os próprios arquivos públicos (logo/ícones/manifest) do usuário deslogado |
| v1.11 | `/reset-password` reconhece link expirado (`error=...&error_code=otp_expired`) direto pelo hash da URL, sem depender do SDK do Supabase; chamadas ao Supabase nessa tela protegidas com try/catch (estado corrompido no localStorage do navegador não derruba mais a página); `app/error.tsx` como rede de segurança geral contra crash de cliente em qualquer tela |
| v1.12 | Gross na aba Sales e por item na edição de nota (reordenado antes de Net); correção do bug de ponto decimal travando nos campos numéricos da nota; categorias que o cliente vende/usa no cadastro (aviso "Verify" por item/nota quando a categoria da compra não bate); breakdown por alíquota (Gross/VAT/Net) expansível por nota na aba Purchases; split automático de PDF em lote (várias notas num arquivo só) por conteúdo via Gemini, uma nota + PDF por documento detectado |
| v1.13 | **Correção urgente**: `vatByRate()` (tela VAT by rate / prep do VAT3) e `exportData()` (Excel/CSV/PDF/Sage/Bright) calculavam VAT por item como `net_amount * aliquota / 100`, tratando preço com imposto embutido (comum em recibos de mercado/varejo) como se já fosse net — superestimava VAT/crédito em notas sem imposto detalhado por linha. Corrigido para usar `computeLines()` (mesma lógica já correta do cálculo de crédito) agrupando por nota. Também separa "Amount €" (editável, valor impresso) de "Gross €"/"Net €" (calculados) na edição de nota, que antes ficavam iguais quando a base era gross, escondendo o net real |
| v1.14 | **Correção urgente**: `detectBasis()` (lib/vat.ts) caía em `"unknown"` (tratado como net) sempre que a soma dos itens não batia com precisão nem com Net nem com Gross do cabeçalho — comum quando a extração perde um item/desconto. Como recibos de varejo/e-commerce quase sempre imprimem o preço já com imposto embutido, tratar como net nesse caso inflava o VAT pela própria alíquota. Agora, quando nenhum bate mas o Gross total é conhecido, assume gross (errar pra gross só subestima, nunca infla). Confirmado com nota real da Temu (item de €8,19 no documento — antes calculava Gross=€10,30 inflado, agora bate certinho). Sem regressão nas notas que já reconciliavam (Q-Park, Dunnes Stores) |
| v1.15 | Botão "+ Add item" na edição de nota (compensa página/item faltando na leitura, mesma lógica de gross); Database/Purchases rolam até a linha da nota aberta e destacam por 2s ao voltar (`lib/useScrollToRow.ts`); botão "Review this batch" no Analyze após salvar, abre a Database filtrada só pelo lote (`?ids=` em `/api/invoices`); botão "Copy" no breakdown por alíquota do Purchases; nova aba "VAT by rate (per invoice)" no export Excel (uma linha por nota) |
| v1.16 | Coluna Item mais larga (240px mín.) na edição de nota; "Base rate %"/"VAT doc %" abreviados e mais estreitos; botão de crédito (toggle) menor — mais espaço pro nome do item |

**Convenção do projeto**: cada mudança é entregue com uma tag de versão + descrição.

## Estrutura do banco (Supabase)

10 tabelas principais: `clients`, `branches`, `chart_of_accounts`, `vat_categories`, `credit_rules`, `items_master`, `invoices`, `invoice_items`, `obligations`, `sales`.

Objetos adicionados desde a v0.1:
- `invoices.posting_date` (data de lançamento)
- `chart_of_accounts.client_id` + tabela `client_item_accounts` (de-para conta)
- `invoices.branch_id` / `invoices.branch_name` (+ tabela `branches`)
- Tabela/objetos de integração Bright (`db/bright_connections.sql`)

SQL versionado em `db/`: `schema.sql`, `seed_supabase.sql`, `seed_vat_categories.sql`, `seed_credit_rules.sql`, `bright_connections.sql`.

## Mapa do código

**Páginas (`app/`)**: `login`, `clients` (lista + `[id]` detalhe), `clients/[id]/accounts` (plano de contas), `/branches` (filiais), `/sales` (vendas), `/vat` (VAT por alíquota), `/bright` (integração), `analyze`, `invoice/[id]`, `base`, `items`, `records`.

**APIs (`app/api/`)**: auth (login/logout/me), `clients` + sub-rotas (accounts, branches, sales, obligations, export, vat-by-rate, bright/export, bright/push), `extract`, `invoices`, `items`, `base`, `credit-rules`.

**Libs (`lib/`)**: `store.ts` (acesso Supabase), `supabase.ts`, `auth.ts`, `matching.ts` (de-para item→base), `extractor/` (gemini, pdfNative, tesseract, prompt, index), `exportXlsx.ts`, `brightApi.ts`, `brightExport.ts`, `loadBase.ts`, `fallbackBase.ts`, `types.ts`.

## Estado verificado em produção

Primeiro cliente criado (Brulor Limited — restaurante/catering) + 3 notas em batch upload OK (2026-07-27). Observação: app parece **um pouco lento em prod** (cold starts / cliente service-role por request) — candidato a otimização.

## Backlog / próximos passos

1. Publicar/tagear formalmente as versões v0.3–v0.8 (código já está no `main`, falta padronizar tags no GitHub).
2. **Ponte Bright/BrightBooks**: a API do BrightBooks/Surf Accounts é *partner-gated* (sem API pública). Solução interim = export CSV / journal como ponte. Concluir a ponte de export.
3. **OCR no navegador** (client-side) para reduzir custo/latência da extração.
4. Confirmar UX da **data de lançamento** (posting_date).
5. **Otimização de performance** em produção (cold start / reuso do client Supabase).

## Como rodar localmente (na nova máquina)

```bash
git clone https://github.com/alfredosilva87-dotcom/vat-erp-ireland.git
cd vat-erp-ireland
npm install
# criar .env.local a partir de .env.local.example e preencher:
#   AUTH_SECRET, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY
npm run dev
```

> As chaves reais **não estão** no repositório (`.gitignore` cobre `.env.local`). Copie os valores do painel da Vercel (Settings → Environment Variables) ou do Supabase (Project Settings → API).

## Para retomar com o Claude na outra máquina

1. Conecte a pasta do projeto (repo clonado).
2. Cole este `HANDOFF.md` no início da conversa.
3. Peça para reconectar os connectors de **Supabase** (ref `qimcehiwxalhvbcpyzvg`) e **Vercel** (team "AJ Projects") se for mexer em infra.
