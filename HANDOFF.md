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

### Acesso pela rede — NÃO está pronto (medido, não presumido)

Levantado em 07/08/2026 quando o usuário informou que o uso real é **várias
pessoas com os mesmos dados**. Dois bloqueios comprovados:

1. **Cookie `Secure`.** `lib/auth.ts:97` usa
   `secure: process.env.NODE_ENV === "production"`. O instalador roda
   `next start` (produção), então a flag liga. Medido: login em
   `http://192.168.0.175:3010` responde 200, o cookie **não** é armazenado, e
   `/api/auth/me` volta `user: null` — loop na tela de login. Em `localhost`
   funciona (origem confiável). **Com HTTPS de verdade isso deixa de ser
   problema e nenhuma mudança de código é necessária** — só sobre HTTP puro é
   que trava.
2. **`NEXT_PUBLIC_SUPABASE_URL` é inlinado no bundle** (confirmado em
   `.next/static/chunks/app/reset-password/*.js`). Único consumidor no
   navegador é `app/reset-password/page.tsx` via `lib/supabaseBrowser.ts`; o
   resto passa pelo servidor. Publicar num endereço exige rebuild com a URL
   correta, senão só a recuperação de senha quebra.

**Correção já aplicada**: o Kong passou a escutar em `127.0.0.1` em vez de
`0.0.0.0` (`ports: !override` no `docker-compose.override.yml`). Antes, o
Studio e a API do banco respondiam para toda a rede, protegidos só pela senha
básica do Studio e pela RLS. Medido antes: `401`/`403` pelo IP da LAN; depois:
conexão recusada. O app (mesma máquina) continua funcionando.

**Achado no stack da fase 1** (`~/Documents/vat-erp-selfhosted-infra/`, que
ainda roda com o `supavisor` ligado): ele publica o **Postgres na porta 5432
para toda a rede** (`supabase-pooler  0.0.0.0:5432->5432`). O pacote `selfhost/`
não faz isso — o `supavisor` está desligado e o `vat-erp-db` só existe dentro
da rede do Docker.

## Modo servidor (2026-08-07)

O uso real informado pelo usuário é **várias pessoas com os mesmos dados**, o
que a instalação por PC não atende (cada cópia tem banco próprio). Servidor
escolhido: **Dell Latitude 5400, Windows 11 Pro, i7-8665U 4c/8t, 32 GB**, nome
de rede `SERVERPAYROLL` — a mesma máquina que já roda a folha de pagamento
(BrightPay/ROS). Secure Boot desligado; criptografia de disco a confirmar.

Recomendação dada e aceita ("resolve do zero"): **servidor central na LAN com
HTTPS interno, sem publicar na internet**. Cloudflare Tunnel foi descartado
*para produção* — passaria o tráfego contábil por terceiro, com o TLS
terminando na borda da Cloudflare, o que contradiz o motivo de terem saído de
Vercel/Supabase. Acesso de fora, se precisar, pela VPN do escritório.

Entregue em `selfhost/server/` + `scripts/install-server.js`:

- **App containerizado** (`server/Dockerfile`, Next.js standalone) com
  `restart: unless-stopped` — o sistema volta sozinho depois de reboot, sem
  ninguém logar. `next.config.js` liga `output: "standalone"` só quando
  `BUILD_STANDALONE=1`, para não mexer no caminho do instalador por PC.
- **Caddy** como porta de entrada HTTPS, com CA interna (`tls internal`).
  Certificado auto-renovado, sem internet. `scripts/export-ca.js` extrai a raiz
  para instalar nas estações.
- **Só o Caddy publica portas.** App, Kong, Studio e Postgres ficam apenas na
  rede do Docker. No Caddyfile, apenas `/auth/v1/*` é roteado para o Kong — é
  o único caminho que o navegador precisa (a tela de recuperação de senha).
  REST, Storage e Studio não são alcançáveis da rede.
- **`SUPABASE_INTERNAL_URL`** (novo, em `lib/supabase.ts`): o servidor fala com
  o Kong pela rede do Docker enquanto o navegador usa a URL pública. Sem isso
  não daria para manter a API fora da LAN, porque as duas pontas usavam a mesma
  variável. Quando não definida, cai no comportamento antigo — instalação por
  PC inalterada.
- `scripts/backup.js` — `pg_dump` (schemas `public` + `storage`) mais os
  arquivos, em pasta datada, mantendo as 14 últimas. **Não criptografa de
  propósito**: o destino é que precisa estar criptografado.
- Guia completo, incluindo o passo de confiar no certificado em cada estação:
  `selfhost/SERVIDOR.md`.

Portas do proxy configuráveis (`VATERP_HTTP_PORT` / `VATERP_HTTPS_PORT`,
padrão 80/443) — necessário porque o Colima não vincula porta privilegiada, e
foi assim que deu para testar no Mac.

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
| v1.17 / v1.17.1 | Instalador self-hosted para Windows e Mac (`selfhost/`); Kong passa a escutar só em 127.0.0.1 e os bloqueios de acesso pela rede ficam documentados |
| v1.18 → v1.18.2 | Modo servidor validado (TLS sem SNI, boot resiliente, guarda de dados); healthchecks com carência e dados em volume Docker; instalador não deixa passar chave Gemini vazia |
| v1.19 | **Camada A0** da conciliação bancária: modelo de dinheiro (contas, linhas de extrato, transações, os dois saldos e a situação de pagamento da nota como view) |
| v1.19.1 | Leitor de extrato agnóstico de formato (`lib/bankStatement.ts`), com o mapeamento de colunas tratado como dado e não como código |
| v1.35 | **O ERP em módulos, com razão contábil próprio.** A maior entrega até aqui, e a que muda a natureza do produto: deixou de ser leitor de notas com relatórios e passou a ter **partida dobrada de verdade**. `journal`/`journal_lines` com a trava de balanço **no banco** (constraint trigger deferred: recusa desbalanceado, partida única, conta fora do plano) — verificar no código só protege o caminho que passa pelo código, e um script de importação passa por fora. `lib/accounting/post.ts` é o tradutor de documento para débito e crédito, **sem um único import**, com a conta corrida em cêntimos inteiros e arredondada uma vez só no fim: três linhas de €33,333 dando €99,99 numa nota de €100,00 é como o cêntimo se perde. O que sobrar vai para `9999 Rounding differences`, à vista, com teto de €1,00 — acima disso não é arredondamento, é erro, e erro estoura. Títulos (`ledger_items`) com baixa parcial onde **o saldo é vista e nunca coluna**, porque coluna-resumo é uma segunda verdade que diverge no dia em que alguém apagar uma baixa por SQL. Decisões deliberadas: **sem** estado pendente/consistido/efetivado (a falha mais cara do Logix — o lançamento nasce balanceado ou é recusado, na hora), plano de contas **partilhado** entre clientes, e rubricas no formato **Schedule 3A** porque a Irlanda não impõe plano de contas, impõe o formato. À volta disso: shell em módulos com permissão por **tela** (não por módulo), módulo RH com a folha do sócio trazida para dentro — e um **bug real do original corrigido no caminho** (`isoWeeksInYear` respondia 53 para quase todo ano, criando uma semana 53 inexistente com payslip cobrado nela em 2021, 2022, 2023, 2027 e 2028), razão contábil com **saldo anterior** (um razão que começa do zero na data escolhida não concilia com nada), contas a pagar/receber com encargos, e relatórios com timbre em PDF e Excel saindo da MESMA função que monta a tela. **Dois defeitos que só o volume destapou:** o PostgREST corta em 1000 linhas **sem avisar**, e a leitura dos saldos não paginava — o balanço saía errado em silêncio, e o único sintoma era a diferença no rodapé, que se lê como lançamento torto e manda procurar no sítio errado; e o balanço levava só o lucro DO PERÍODO enquanto os saldos chegam acumulados, então o resultado dos anos anteriores ficava fora do património — diferença de assinatura inconfundível assim que há mais de um exercício. Os dois com teste de regressão, incluindo a prova ao contrário. 748 asserções, `tsc` limpo |
| v1.34 | **A trava RELAY_ONLY faltava aplicar em produção, e a tela de captura ganhou marca própria e recorte de perspectiva.** Conferindo a implantação real na Vercel, `/login` respondia 200 — a variável `RELAY_ONLY=1` nunca tinha sido colocada lá; depois de o Alfredo adicionar e reimplantar, confirmado 404 em `/login` e `/api/invoices`, 200 na captura. Visual da tela de `/enviar/<token>` refeito com a referência que ele mandou: logotipo, cartões com ícone e seta, curva decorativa no rodapé — a única frase alterada foi a de segurança, trocando "nível bancário" (não verificável) por "este link só envia, não lê nada" (literalmente verdade, mesma promessa do Cadastro). **Recorte por perspectiva** depois da foto: em vez do scanner ao vivo (semanas de risco real no Safari), a pessoa arrasta os 4 cantos sobre a foto já tirada e `lib/perspective.ts` resolve a homografia por álgebra linear pura — sem IA, sem biblioteca de visão computacional. 32 testes cobrem a matemática, incluindo recuperar exatamente os 9 coeficientes de um caso com perspectiva de verdade (não só afim) e a interpolação bilinear conferida cor por canal na mão. Provado de ponta a ponta no navegador: uma imagem sintética com um quadrilátero azul deliberadamente torto, os 4 cantos arrastados por eventos de ponteiro reais (não a função chamada direto) até casar com o formato, e a saída amostrada em 4 pontos veio uniformemente azul, sem branco vazando na borda. **Um bug de verdade apareceu no caminho**: `setPointerCapture` lança exceção não capturada quando o navegador não reconhece o `pointerId` como ponteiro ativo, e sem `try/catch` isso abortava a função antes de `setDragging` rodar — a primeira arrastada sempre funcionava, a segunda em diante silenciosamente não fazia nada. "Pular" sempre manda a foto inteira sem recorte, para quem só quer mandar rápido |
| v1.32 | **Camada B4 — o cliente fotografa a nota onde ela é entregue.** O pedido era a praticidade do Dext: foto no posto de combustível e ela chega ao analista. O obstáculo não era código — o telefone está no 4G e o servidor é da rede do escritório, então **algo tem que ser alcançável**. A captura e o recebimento ficam numa **passagem na nuvem** (Vercel + Supabase separado), e o servidor do escritório **busca e apaga**: provado com a passagem terminando em 0 linhas e 0 arquivos, que é o que faz dela trânsito e não armazenamento. Quem envia **não é usuário e não tem senha** — recebe um link por pessoa, revogável. A razão não é conveniência: senha protege leitura, e o token não lê nada; o pior caso de um link vazado é foto de lixo na fila, que o analista descarta. Em troca: teto de 40 envios por 10 minutos (o token vai na URL, logo no WhatsApp e no histórico), **a direção quem decide é o link e não o pedido** — provado de ponta a ponta mandando `direction=sale` num link sem venda e ele entrando como despesa —, nome de arquivo montado do que é confiável (`../../etc/passwd` sai inofensivo) e hash recalculado no servidor, senão a trava de duplicata obedeceria a um número escolhido por quem enviou. **Não fiz OCR no telefone**, que era a ideia inicial: o escritório precisa guardar o documento de qualquer jeito, então mandar só texto não economiza nada — e um PDF com OCR é maior que a foto. O telefone reduz a imagem (borda longa 2000 px), porque a Vercel corta o corpo em 4,5 MB e porque envio curto é o que termina no 4G do posto. A fila fica no **IndexedDB com o arquivo**: foto tirada sem sinal e perdida é pior que foto não tirada, porque o cliente acha que mandou. Cai na MESMA fila e na MESMA trava de duplicata do e-mail, com `source='phone'`. A tela é pública e segue o `Accept-Language` do telefone — sem sessão não há cookie de idioma, e o cliente veria inglês. O **Buscar agora** passou a trazer as duas portas numa volta: a fila é uma, o gesto também |
| v1.31.1 | **Registro das licenças emitidas.** O `license-issue.js` imprimia a chave e esquecia: se o e-mail ao cliente se perdesse, não havia de onde copiar de novo nem como saber o que foi emitido para quem — reemitir funcionava, mas sem histórico. Agora cada emissão é gravada em `~/.vat-erp-license/issued.jsonl` (uma linha por licença, permissão 600, junto da chave privada), **antes** de imprimir, para o terminal fechado não levar a chave junto. Novo `license-list.js` lista e devolve a chave para copiar (`--id <id>`, cru, para mandar direto ao `pbcopy`). Ele confere cada chave guardada contra a chave pública embutida, então linha adulterada ou truncada aparece como INVÁLIDA em vez de ir para o cliente e falhar na tela dele. "Vigente" é a de vencimento mais longe, não a mais recente — reemitir com menos meses não encurta o que o cliente já tem, e a lista precisa concordar com o `checkFit`. A licença da Precise Tax, emitida antes do registro existir, foi lançada derivando os campos da própria chave. Emitir continua sendo só neste Mac; o console web de fora fica para quando a implantação privada existir, porque a chave privada vive onde o painel roda e a implantação que o cliente testa não deve ser essa |
| v1.31 | **Licença assinada, gerada sem entrar no sistema do cliente.** O defeito era de fluxo: a chave antiga era um texto aleatório gravado em `pending_license_key` **no banco do cliente**, e a ativação só comparava com a cópia guardada — logo, liberar um cliente exigia entrar na instalação dele, que é o que o self-host impede. Agora a chave carrega a própria verdade e vem assinada (`VATERP1.<carga>.<assinatura>`, Ed25519): diz para quem é, até quando vale e quando foi emitida. A privada fica em `~/.vat-erp-license/`, fora do repositório; a pública está embutida no código. Assimétrico e não segredo compartilhado, porque segredo que precisa estar na máquina do cliente é segredo do cliente. Dois scripts novos: `license-keygen.js` (uma vez) e `license-issue.js` (por licença). O admin passou a **ver a própria licença** em Configurações → Licença — estado, validade, dias restantes — que era a lacuna reportada. E o certificado do servidor passou a cobrir os **IPs** da máquina além do nome: confiar na CA resolvia "autoridade desconhecida" mas não "nome errado", e por isso o acesso por IP continuava marcado como não seguro |
| v1.30 | **Autorização entre empresas, e revisão visual.** A revisão de segurança achou o buraco: o sistema é multiempresa desde a v1.5, mas o escopo por empresa existia em **7 de 68 rotas**. Com o UUID de uma nota, qualquer usuário autenticado lia, alterava e **baixava o documento** de outro escritório; `GET /api/invoices` sem filtro devolvia as notas de todos. Não havia rede no banco: as tabelas têm RLS, mas o app usa a chave de serviço, que a ignora. Num self-host de um escritório só nunca se manifesta; **na cópia em nuvem é sigilo fiscal de terceiro.** Novo `lib/access.ts` com um guarda por tipo de recurso, aplicado em 66 handlers, e um **teste que quebra o `npm test` se uma rota nova esquecer o guarda** — autorização que depende de lembrar tem buraco. Recusa é 404, não 403: "existe, mas não é seu" já conta que existe. Layout: a busca falsa do topo saiu (levava para a Database sem buscar nada), a faixa do topo inteira saiu, "Visão geral" virou parte do Painel, Filiais e E-mail viraram o **Cadastro**, e as ações mais usadas subiram para o lado do nome do cliente. Paleta clara e suave como padrão, com a barra lateral clara |
| v1.29 | **Camada B3 — FASE B COMPLETA**: trilha de auditoria por nota (quem mudou o quê, com o valor antigo ao lado do novo), juntar duplicatas em vez de descartar, e aprovação em lote. A trilha é escrita **no mesmo caminho** da alteração, não por uma chamada que a tela precisa lembrar de fazer — trilha com buracos vale menos que nenhuma, porque dá impressão de cobertura. Só o campo que mudou entra (de 12 enviados, entrou 1), e número é comparado por valor e não por texto. Juntar anexa a segunda foto ao lançamento e **não recalcula nada**: se os dois documentos divergem, isso é decisão do contador, não média do sistema. Aprovar não exige administrador (é reversível e não cria lançamento); desfazer exige. **Dois defeitos encontrados no teste:** a chave estrangeira do autor recusava a linha da trilha quando o usuário não existia mais — os campos de autor viraram uuid solto, porque trilha de auditoria não pode depender de outra tabela ter suas linhas; e o `catch` silencioso escondia isso, deixando o histórico vazio e indistinguível de nota nunca alterada |
| v1.28 | **Camada B2** (ingestão): entrada por e-mail. O servidor **busca** por IMAP numa caixa do escritório — receber SMTP exigiria abrir porta e publicar MX apontando para dentro da rede local. Um endereço por cliente e por direção, com sub-endereçamento (`notas+htvfmk5d@…`); o token é opaco porque o endereço vai para as mãos de fornecedores, e `notas+c0001@` contaria quantos clientes o escritório tem. Nova fila do servidor (`inbox_items`) — a "fila" anterior era a lista dentro do navegador, e e-mail chega sem navegador. **O logotipo da assinatura não vira item na fila**, senão cada fatura criaria dois. Recusa nunca guarda o anexo, e remetente bloqueado não deixa linha (só o contador da busca); todo o resto deixa linha com o motivo. A senha do IMAP vem do ambiente, nunca do banco. Ler e gravar saíram para `lib/ingestFlow.ts`, para a nota que entra por e-mail passar pelo mesmo caminho da que entra arrastada |
| v1.27.1 | **Camada B2, parte 1**: as decisões da entrada por e-mail como função pura, com 47 testes, antes de qualquer rede — mesma ordem da camada A1 |
| v1.27 | **Camada B1** (ingestão): regra por fornecedor, com a precedência escrita na tela — **escolha manual > regra > o que o sistema aprendeu**. Campo vazio na regra não decide nada, e é assim que um supermercado ganha destino contábil sem ter as alíquotas das suas linhas achatadas num número só. Interruptor de itens de linha por fornecedor: desligado, a nota entra como uma linha com o total do documento e **a classificação por IA não roda** (medido: 3 linhas e 1 chamada viraram 1 linha e 0 chamadas). Corrige de passagem um defeito mudo — `saveInvoice` sobrescrevia a conta de toda linha com a memória item→conta, então a regra apareceria certa na leitura e a nota gravaria outra conta |
| v1.26 | **Camada A7 — FASE A COMPLETA**: conciliação em massa para o que se repete e não tem documento (tarifa, juro, taxa de cartão), com filtro, ordenação e propagação de conta. Por decisão de projeto o lote **nunca casa com nota ou venda** — quem passa o lote primeiro consome com "tarifa" linhas que eram pagamento de nota; a linha que tem documento aparece travada na tela e a rota recusa o vínculo |
| v1.25 | **Camada A5** (fechamento): relatório de conciliação que separa a diferença explicada pelas pendências da diferença contra o saldo lido no extrato de papel — a segunda é a única que acusa linha que nunca foi importada. Fechamento gravado com a fotografia das pendências do dia, e trava de período valendo em conciliar, desconciliar, refazer, religar e importar. Reabrir só de administrador |
| v1.24 | **Camada A4** (casos difíceis): uma linha do extrato pode liquidar várias notas de uma vez, pagar parcialmente (a nota continua devendo o resto), e a diferença que sobra vira lançamento próprio — arredondamento até 5 cêntimos, ou a conta que o contador escolher para tarifa/juro. O botão de gravar só acende quando a soma das partes fecha com a linha |
| v1.23.1 | PDF de extrato passa a ser lido **por coordenada** (`lib/extractor/pdfLayout.ts`): o primeiro extrato real (AIB) sai sem espaço nenhum entre as colunas — `14 Jul 2026VDP-PREMIER LOTTER10.00412.80` — e só a posição na página diz o que é saída, entrada e saldo. 33 movimentos lidos, os 14 saldos impressos fechando. Também corrige a conferência de saldo, que dava alarme falso em banco que imprime o saldo uma vez por dia |
| v1.23 | **Camada A6** (antecipada a pedido): extrato bancário em PDF, com o sinal de cada movimento deduzido do saldo corrido do próprio documento e IA só para PDF escaneado. **Correção de peso**: o `pdf-parse` falhava dentro do Next para qualquer PDF (Buffer do pool do Node começa no meio de um bloco maior, e o pdf.js embutido lia do início) — e como a falha era silenciosa, **toda nota fiscal em PDF nativo vinha sendo lida por IA**, pagando por isso e perdendo o texto exato. Medido: 1 s em vez de 10 s por arquivo |
| v1.22.1 | Rotas `GET` voltavam de cache e a tela mostrava lista vazia; 26 rotas passaram a `force-dynamic` |
| v1.22 | **Camada A3**: regras de banco por cliente, avaliadas na ordem da tela e parando na primeira que casa; aviso de qual regra nunca vai acontecer por estar engolida por outra acima; divisão do valor em várias contas (percentual ou fixo) com a sobra do arredondamento na maior parcela |
| v1.21 | **Camada A2**: conciliação com sugestão de casamento (motor puro em `lib/bankMatch.ts`), tela de duas colunas com o motivo da proposta escrito, desconciliar × refazer como operações distintas, e religar linha a movimento já lançado sem duplicar dinheiro |
| v1.20 | **Camada A1 completa**: telas de conta bancária com os dois saldos, importação de extrato com pré-visualização e ajuste de mapeamento, gravação com anti-duplicata no próprio banco (índice único + `on conflict do nothing`), desfazer lote, e leitura de planilha extraída para `lib/sheet.ts` |

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
