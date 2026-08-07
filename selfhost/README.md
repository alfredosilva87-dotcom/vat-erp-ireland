# Instalação do VAT ERP em um computador novo

O sistema roda **100% dentro do computador**: aplicação, banco de dados e os
arquivos das notas. Nada vai para a nuvem. Cada PC instalado tem o seu próprio
banco — os dados **não** são compartilhados entre máquinas.

> **Várias pessoas usando os mesmos dados?** Então não é esta instalação —
> cada cópia teria o seu próprio banco. Use o
> **[servidor do escritório](SERVIDOR.md)**: uma máquina central com HTTPS, e as
> estações só abrem o navegador.

---

## Antes de começar

O PC precisa de:

| | Mínimo | Recomendado |
|---|---|---|
| RAM | 8 GB | 16 GB |
| Disco livre | 10 GB | 20 GB |
| Sistema | Windows 10/11 (64-bit) ou macOS | — |

E de dois programas, instalados **nesta ordem**:

1. **Node.js** — versão LTS, em <https://nodejs.org>
2. **Docker Desktop** — em <https://docs.docker.com/desktop/>
   - Windows: o instalador liga o WSL2 sozinho; ele pede para reiniciar o PC. Reinicie.
   - Mac com macOS 13 (Ventura) ou mais antigo: o Docker Desktop **não** funciona.
     Use o Colima no lugar (veja [Mac antigo](#mac-antigo-ventura-ou-anterior)).

Depois de instalar o Docker Desktop, **abra o programa** e espere o ícone da
baleia ficar verde / escrito *Running*. O instalador não funciona com o Docker
fechado.

---

## Instalação

### 1. Copie o projeto para o PC

Com o Git instalado:

```bash
git clone https://github.com/alfredosilva87-dotcom/vat-erp-ireland.git
```

Sem Git: baixe o ZIP do repositório no GitHub (**Code → Download ZIP**) e
extraia para uma pasta que **não** seja sincronizada por OneDrive/Dropbox/iCloud
— o banco de dados fica dentro dessa pasta e a sincronização corrompe os
arquivos do Postgres. `C:\vat-erp` ou `~/vat-erp` servem bem.

### 2. Rode o instalador

- **Windows**: duplo clique em `selfhost\install.bat`
- **Mac**: duplo clique em `selfhost/install.command`

> No Mac, na primeira vez o sistema pode bloquear o arquivo. Clique com o botão
> direito → **Abrir** → **Abrir**.

Ele vai perguntar três coisas:

| Pergunta | O que responder |
|---|---|
| E-mail | o login do administrador deste PC |
| Senha | mínimo 8 caracteres, digitada duas vezes |
| `GEMINI_API_KEY` | chave gratuita de <https://aistudio.google.com> → *Get API key*. Pode deixar em branco e preencher depois em `.env.local` — sem ela tudo funciona, menos a leitura automática das notas. |

Daí em diante é automático (10 a 20 minutos na primeira vez, quase tudo é
download das imagens do Docker):

1. baixa e sobe o banco de dados e os serviços;
2. cria as tabelas e carrega a base de alíquotas e as regras de crédito;
3. cria o usuário administrador;
4. compila a aplicação.

No fim ele mostra o endereço e o login.

### 3. Usar no dia a dia

- **Windows**: duplo clique em `selfhost\start.bat`
- **Mac**: duplo clique em `selfhost/start.command`

O navegador abre sozinho em <http://localhost:3000>. **Deixe a janela preta
aberta** enquanto estiver usando — fechar a janela desliga o app.

Para desligar o banco também (libera memória): `selfhost\stop.bat` /
`selfhost/stop.command`.

---

## O que o instalador cria

| Onde | O quê |
|---|---|
| `selfhost/docker/.env` | as chaves de segurança geradas para **este** PC |
| `selfhost/config.json` | as portas escolhidas |
| `.env.local` | configuração da aplicação |
| `selfhost/docker/volumes/db/data/` | **o banco de dados** |
| `selfhost/docker/volumes/storage/` | os PDFs/imagens das notas |

Nenhum desses arquivos vai para o git. As duas últimas pastas são os dados
reais — **não apague, e é isso que precisa de backup**.

---

## Perguntas frequentes

**Os dados aparecem nos dois computadores?**
Não. Cada instalação tem o seu próprio banco. Este pacote instala um sistema
independente por PC.

**As portas 3000/8000 estão ocupadas.**
O instalador detecta e usa as próximas livres (3010, 8010...), e grava a escolha
em `selfhost/config.json`. O endereço certo aparece no fim da instalação e toda
vez que você inicia o app.

**Posso rodar o instalador de novo?**
Pode. Ele reaproveita as chaves e o banco que já existem; só recria as tabelas
que faltarem e **redefine a senha do administrador** para a que você digitar.

**Esqueci a senha do administrador.**
Rode o instalador de novo com o mesmo e-mail e escolha uma senha nova.

**Como abrir o banco direto?**
O Supabase Studio sobe junto, no endereço da API (`http://localhost:8000` por
padrão). Usuário `supabase`, senha no `DASHBOARD_PASSWORD` de
`selfhost/docker/.env`.

Ele só responde **na própria máquina** — de propósito (veja
[Exposição na rede](#exposição-na-rede)). Para abrir o Studio de outro
computador, faça um túnel em vez de publicar a porta:

```bash
ssh -L 8000:127.0.0.1:8000 usuario@maquina-do-servidor
```

**Outras pessoas conseguem acessar o sistema pela rede?**
Como está, não com segurança. Leia [Exposição na rede](#exposição-na-rede).

**Deu erro — onde vejo o motivo?**
```bash
node selfhost/scripts/logs.js
```

---

## Exposição na rede

Esta instalação foi feita para **uma máquina, um usuário**. Ela não está pronta
para outras pessoas acessarem, e há duas razões técnicas concretas:

**1. O cookie de sessão exige HTTPS.** Em build de produção o cookie sai com a
flag `Secure`, e o navegador só aceita cookie `Secure` em `https://` ou em
`localhost`. Se alguém abrir `http://192.168.x.x:3000`, o login responde OK, o
navegador descarta o cookie e a pessoa fica presa na tela de login. Não é bug:
é o navegador se recusando a trafegar sessão em claro.

**2. O endereço do banco entra no JavaScript no momento do build.** Só a tela de
recuperação de senha fala direto com o banco pelo navegador; num acesso remoto
ela apontaria para o `localhost` de quem está acessando. Se o sistema for
publicado num endereço, `NEXT_PUBLIC_SUPABASE_URL` precisa ser esse endereço e
o app precisa ser recompilado.

Por isso o Kong (a porta que dá acesso ao Studio e à API do banco) escuta
**apenas em `127.0.0.1`** — veja o comentário em
`docker/docker-compose.override.yml`. O Postgres não é publicado no host de
forma alguma: só existe dentro da rede do Docker.

Para várias pessoas usando os mesmos dados, o desenho certo é **um servidor
central com HTTPS**, e não uma cópia por PC — cada instalação tem o seu próprio
banco.

## Mac antigo (Ventura ou anterior)

O Docker Desktop exige macOS 14 (Sonoma). Em macOS 13 ou anterior, use o Colima:

```bash
brew install docker docker-compose colima
```

```bash
colima start --cpu 2 --memory 4 --disk 20
```

Depois rode `selfhost/install.command` normalmente. O `start.command` liga o
Colima sozinho quando ele estiver parado.

---

## Detalhes técnicos

O stack é o **Supabase self-hosted oficial** (a pasta `docker/` vem do
repositório `supabase/supabase`), com dois ajustes em
`docker/docker-compose.override.yml`:

- `realtime`, `supavisor` e `functions` ficam atrás de um profile — a aplicação
  não usa nenhum dos três, e desligá-los devolve ~500 MB de RAM. Para subir um
  deles: `docker compose --profile extras up -d`.
- todos os containers são renomeados com prefixo `vat-erp-`, porque o arquivo
  original fixa nomes `supabase-*` que são globais no Docker e colidem com
  qualquer outro stack Supabase na mesma máquina.

As chaves são geradas por `scripts/lib/secrets.js`, uma versão em Node do
`docker/utils/generate-keys.sh` oficial (que é `/bin/sh` e não roda no Windows)
— mesmos algoritmos, mesmos tamanhos, mesmo formato de JWT.

O SQL aplicado está em `schema/`, na ordem 001 → 002 → 003, e é idempotente. O
003 roda como `supabase_admin`: `storage.buckets` pertence ao
`supabase_storage_admin`, e o papel `postgres` não é superusuário na imagem da
Supabase.

Para instalação sem perguntas (servidor, reinstalação em massa), defina
`VATERP_ADMIN_EMAIL`, `VATERP_ADMIN_PASSWORD` e `VATERP_GEMINI_KEY` antes de
chamar `node selfhost/scripts/install.js`.
