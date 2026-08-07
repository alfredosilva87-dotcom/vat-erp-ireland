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

## Self-hosting (2026-08-07 — em andamento)

O escritório aprovou o sistema (2026-08-06) e exigiu **self-hosting 100% local**
(app + banco + storage) por compliance de proteção de dados irlandesa — não
mais Vercel/Supabase gerenciados. Fase 1 (teste no Mac do usuário) já está
funcionando; fase 2 é migrar isso pro servidor real do escritório.

- **Infra separada do repo do app**, em
  `~/Documents/vat-erp-selfhosted-infra/` (fora do git deste projeto de
  propósito):
  - `docker/` — sparse-clone oficial do `supabase/supabase` (só a pasta
    `docker/`), o compose self-hosted padrão da Supabase.
  - `schema/001_full_schema.sql`, `002_seed_reference_data.sql`,
    `003_storage_bucket.sql` — schema consolidado puxado direto de
    `supabase_migrations.schema_migrations` da produção (mais confiável que
    os arquivos `db/*.sql` deste repo, que ficaram desatualizados — ex: a
    tabela `clients` nunca teve `CREATE TABLE` versionado aqui).
- **Runtime**: Docker via **Colima** (não OrbStack/Docker Desktop — ambos
  exigem macOS 14+/Sonoma; este Mac está no 13.7.8/Ventura). Instalado via
  Homebrew: `docker`, `docker-compose`, `colima`. Iniciar com
  `colima start --cpu 2 --memory 4 --disk 20` (ajustado pra 8GB RAM total
  da máquina).
- **Segredos** gerados via `docker/utils/generate-keys.sh --update-env` —
  ficam só em `docker/.env` (gitignored, fora do repo do app de qualquer
  forma).
- **`.env.local` do app**: aponta pro stack local
  (`NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000`, chaves geradas no
  passo acima). Os valores de produção (nuvem) estão salvos em
  `.env.local.cloud-backup` (gitignored) — não apagados, só substituídos.
- **Senha do admin no banco local**: o hash puxado da migration original
  correspondia a uma senha antiga (a senha de produção foi trocada depois
  via SQL direto, que não fica em migration rastreada) — foi atualizado
  manualmente pra bater com a senha atual de produção.
- **Dados**: só estrutura + referência (`vat_categories`, `credit_rules`) +
  o usuário admin. **Nenhum dado real de cliente foi copiado** pra essa
  instância de teste, propositalmente, já que ela vai ficar exposta na
  internet para teste de acesso remoto.
- **Testado e confirmado funcionando**: login, dashboard, criar/editar/
  apagar cliente — caminho completo de leitura e escrita contra o Postgres
  self-hosted.
- **Pendente**: método de exposição pra internet (Cloudflare Tunnel
  recomendado — grátis, sem port-forward, HTTPS real, não expõe IP
  residencial — vs ngrok pra teste rápido único) precisa de confirmação do
  usuário antes de ativar. Depois: migrar essa mesma receita pro servidor
  real do escritório (specs ainda não levantadas).

## Instalador self-hosted (2026-08-07 — fase 2)

A receita da fase 1 (que era manual, em `~/Documents/vat-erp-selfhosted-infra/`,
fora do git) virou um **pacote de instalação versionado em `selfhost/`**, para
rodar em outro PC — Windows ou Mac. Decisão do usuário: **cada PC é standalone**
(app + banco + storage próprios, dados não sincronizam entre máquinas) e o
banco novo nasce só com **estrutura + dados de referência + admin**, sem dado
real de cliente.

- `selfhost/install.bat` / `.command` → `scripts/install.js`: escolhe portas
  livres, gera as chaves, sobe o Docker, aplica o schema, cria o admin com a
  senha digitada na hora e faz o build. Node puro, mesmo código nos dois SOs.
- `selfhost/start.*` / `stop.*`: uso diário. O app roda em build de produção
  (`next start`), não `next dev`.
- `selfhost/docker/`: cópia do compose oficial da Supabase +
  `docker-compose.override.yml` (desliga realtime/supavisor/functions, renomeia
  containers para `vat-erp-*`).
- `selfhost/schema/`: mesmo SQL da fase 1, agora **idempotente** (enums em
  `do $$ ... exception when duplicate_object $$`, `add column if not exists`) e
  **sem o hash de senha hardcoded** — o admin é criado pelo instalador com
  `pgcrypto crypt(..., gen_salt('bf'))`, que o `bcryptjs` do app valida.
- Guia: `selfhost/README.md`. Roteiro de teste: `selfhost/TESTE.md`.
- Instalação sem perguntas (servidor): `VATERP_ADMIN_EMAIL`,
  `VATERP_ADMIN_PASSWORD`, `VATERP_GEMINI_KEY`.

**Achados que só apareceram por testar a instalação de ponta a ponta** (todos
já corrigidos):
1. `container_name: supabase-*` é global no daemon — dois stacks Supabase na
   mesma máquina colidem, mesmo com `COMPOSE_PROJECT_NAME` diferente.
2. `COMPOSE_FILE` no `.env.example` faz o Compose **ignorar** o
   `docker-compose.override.yml`; precisa listar os dois arquivos, com
   `COMPOSE_PATH_SEPARATOR=:` explícito para o Windows.
3. `storage.buckets` nega escrita ao papel `postgres` (não é superusuário na
   imagem da Supabase) — o 003 tem que rodar como `supabase_admin`.
4. `next build` type-checava os exemplos Deno que vêm dentro de
   `selfhost/docker/volumes/functions/` e quebrava; `tsconfig.json` agora
   exclui `selfhost`.

**Testado no Mac em 07/08/2026**, ciclo completo: instalar → logar → criar
cliente → salvar nota com PDF → sair → parar tudo → subir de novo → reentrar,
com cliente, nota, itens, totais e PDF preservados. **Falta validar no Windows
real** (Docker Desktop + WSL2).

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
