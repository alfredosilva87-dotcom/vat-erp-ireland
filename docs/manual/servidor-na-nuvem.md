# A implantação da nuvem a fazer de servidor do escritório

**Decisão de 2026-08-25.** Até o primeiro cliente ser instalado num servidor a
sério, o ERP publicado na Vercel (`vat-erp-ireland`) passa a fazer o papel que
o manual dá ao servidor do escritório: além de servir as telas, é ele que
**busca as fotos na passagem e as apaga de lá**.

Isto não estava previsto. O `docs/manual/install-server.html` manda pôr as
variáveis da passagem em `selfhost/docker/.env` — o servidor local — e é por
isso que a implantação da nuvem responde `configured:false`: nunca teve esse
papel, não é regressão nenhuma.

> **Variáveis de ambiente da Vercel vivem nas definições do projeto, não no
> git.** Publicar código novo nunca as apaga. Se algo deixou de funcionar
> depois de um deploy, a causa não é a variável ter-se perdido.

---

## 1. O que fazer agora

### 1.1 Buscar a chave secreta da passagem

No painel do Supabase, projeto **`vat-erp-passagem`** (ref `sezukkzoaktncvjhzcan`,
região eu-west-1) → **Project Settings → API Keys** → carregar em **Reveal** na
chave **`service_role`** (a *secret*; começa por `sb_secret_`).

Tem de ser a `service_role`, e não a publicável: a passagem tem RLS ligada **sem
política nenhuma**, então a chave anónima não lê nem escreve lá nada. Toda a
validação do token acontece no servidor, antes de tocar no banco.

### 1.2 Acrescentar três variáveis no projeto do ERP

Vercel → projeto **`vat-erp-ireland`** → **Settings → Environment Variables**.
Marcar os três ambientes (Production, Preview, Development) em cada uma:

| Variável | Valor |
|---|---|
| `RELAY_SUPABASE_URL` | `https://sezukkzoaktncvjhzcan.supabase.co` |
| `RELAY_SUPABASE_SERVICE_ROLE_KEY` | a chave `service_role` do passo 1.1 |
| `PHONE_CAPTURE_URL` | `https://vat-erp-captura.vercel.app` |

São exactamente as mesmas três linhas que o manual manda pôr em
`selfhost/docker/.env`. O papel é o mesmo; só muda onde o processo corre.

### 1.3 Duas variáveis que NÃO podem entrar aqui

| Variável | O que acontece se entrar |
|---|---|
| `RELAY_ONLY` | O middleware devolve **404 em tudo** que não seja a tela de envio. O ERP inteiro sai do ar — login incluído. |
| `LICENSE_CONSOLE` | O mesmo, ao contrário: só `/console` responde, e o resto dá 404. |

As duas existem para garantir que uma implantação que serve **uma coisa só** não
serve o resto por acidente de configuração. No ERP, que serve tudo, são
exactamente o veneno.

### 1.4 Reimplantar

Variável nova só entra num **build novo**. Vercel → **Deployments** → o mais
recente → menu `⋯` → **Redeploy**.

### 1.5 Conferir

Sem entrar na tela, com uma sessão válida:

```bash
curl -s -b cookie.txt \
  "https://vat-erp-ireland.vercel.app/api/clients/<ID-DO-CLIENTE>/phone-links"
```

- **Antes:** `{"links":[],"captureBase":null,"configured":false}`
- **Depois:** `configured: true` e `captureBase` com o endereço da captura.

Na tela: abrir um cliente → **Cadastro** → secção **Enviar pelo telemóvel**. O
botão de criar link só aparece quando `configured` é verdadeiro.

---

## 2. O mapa completo, das três implantações

O mesmo repositório é publicado três vezes, com papéis diferentes. É a
configuração que decide o papel — não há três códigos.

### 2.1 ERP (`vat-erp-ireland`) — serve tudo

| Variável | Para quê | Obrigatória |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | o banco do escritório | sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem, chave publicável | sim |
| `SUPABASE_SERVICE_ROLE_KEY` | idem, chave secreta — é a que a app usa | sim |
| `AUTH_SECRET` | assina o cookie de sessão | sim |
| `GEMINI_API_KEY` | leitura do documento | para extrair |
| `GEMINI_MODEL` | fixa o modelo; sem ela usa o padrão | não |
| `RELAY_SUPABASE_URL` | **novo** — a passagem | para o telemóvel |
| `RELAY_SUPABASE_SERVICE_ROLE_KEY` | **novo** | para o telemóvel |
| `PHONE_CAPTURE_URL` | **novo** — para montar o link inteiro | para o telemóvel |
| `MAIL_IMAP_HOST` … `MAIL_INBOX_ADDRESS` | entrada por e-mail (IMAP) | só se usar |
| `LICENSE_PUBLIC_KEY` | confere a licença; há uma embutida no código | não |
| `SUPABASE_INTERNAL_URL` | só no self-host, rede interna do Docker | não |

### 2.2 Captura (`vat-erp-captura`) — só a tela de envio

`RELAY_SUPABASE_URL`, `RELAY_SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SECRET` — **todas apontando para a
passagem**, e não para o banco do escritório — mais `RELAY_ONLY=1` e,
opcionalmente, `CRON_SECRET`.

Aqui as `NEXT_PUBLIC_*` e a `SUPABASE_SERVICE_ROLE_KEY` apontam para a
passagem de propósito: se um dia alguém colar ali por engano a chave do
escritório, é o `RELAY_ONLY` que impede o estrago — a implantação **não tem** as
outras rotas para servir.

O `keepalive` (cron diário no `vercel.json`) mora aqui: o plano gratuito do
Supabase **pausa o projeto ao fim de 7 dias sem atividade**, e quando pausa o
link no telemóvel dos clientes deixa de funcionar em silêncio. Já aconteceu em
2026-08-24.

### 2.3 Servidor do escritório — quando existir

`selfhost/docker/.env`, com as variáveis do stack Supabase self-hosted mais as
três da passagem. Ver `docs/manual/install-server.html`, passo 3.

---

## 3. Quando mudar para o servidor a sério

O papel de "quem busca na passagem" muda de sítio. **Não se acrescenta — troca-se
de mãos**, senão os dois buscam a mesma foto e um deles apaga-a antes do outro
a ver.

1. **Instalar o servidor** pelo `install-server.html`, até ter o ERP a responder
   na rede do escritório.
2. **Levar os dados**: exportar da nuvem e carregar no local. O plano de contas
   é semeado pelas migrações; o que viaja são clientes, documentos, títulos e
   razão.
3. **Pôr as três linhas** em `selfhost/docker/.env` — os **mesmos valores** desta
   página. A passagem é partilhada; não se cria uma nova.
   Reiniciar: `docker compose up -d app`.
4. **Tirar as três da Vercel**, ou desactivar o ERP da nuvem. É este o passo que
   se esquece: enquanto as duas implantações tiverem as variáveis, as duas
   buscam, e a foto entra numa e desaparece para a outra.
5. **Os links do telemóvel não mudam.** Vivem na passagem, apontando para o id
   do cliente — se os ids forem preservados na migração, os clientes não dão por
   nada. **Se os ids mudarem, todos os links partem**, e é preciso reemitir cada
   um. Vale a pena preservar os ids.
6. **Conferir**: mandar uma foto e ver aparecer na Caixa de entrada do servidor
   local, e **não** na nuvem.

---

## 4. O teto de 60 segundos — o que a nuvem não consegue fazer

O plano da conta Vercel é **Hobby**, e nele uma função corre **no máximo 60
segundos**. Não se resolve por código nem por variável: as rotas que declaram
mais do que isso são cortadas na mesma.

**A extração de documento já bate no teto.** `POST /api/extract` devolveu 504
duas vezes, aos 60,4 s e 60,8 s, com um PDF de 1 KB. Declara `maxDuration = 60`
e mesmo assim não chega.

Consequência prática enquanto a nuvem fizer de servidor: a foto **chega** à
Caixa de entrada — buscar da passagem é só descarregar e voltar a gravar, e não
lê nada —, mas o passo de **ler o documento falha**. Analisar tem de ser feito
no servidor local, ou com o plano mudado.

**E há rotas que ainda não bateram só porque o volume é pequeno.** Estas
declaram mais de 60 s e vão ser cortadas na mesma quando um cliente a sério
entrar:

| Rota | Declara | O que acontece |
|---|---|---|
| `accounting/backfill` | 300 s | Contabilizar centenas de documentos corta a meio |
| `bank-accounts/…/import/pdf` | 300 s | Extrato grande em PDF não termina |
| `phone/fetch`, `mail/fetch` | 120 s | Muitas fotos ou e-mails de uma vez |
| `sales/read-sheet` | 120 s | Planilha de vendas grande |
| `accounting/export.pdf`, `.xlsx`, `ledger.*` | 120 s | Razão de um cliente com anos de movimento |

Com os cinco clientes de demonstração nada disto se manifesta — o backfill dos
cinco correu em segundos. **Não confunda isso com estar resolvido.** O backfill
é o mais perigoso dos cinco: cortado a meio deixa metade do razão dentro e
metade fora, e correr outra vez é seguro (é idempotente por documento) mas
volta a cortar no mesmo sítio se o volume não couber.
