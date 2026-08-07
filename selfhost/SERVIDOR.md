# Servidor do escritório — instalação e operação

Um servidor, várias pessoas, **os mesmos dados**. As estações não instalam
nada: abrem o navegador.

Nada é publicado na internet. Quem precisar acessar de fora entra pela VPN do
escritório — o sistema continua sem endereço público.

---

## Por que assim (para quem for revisar)

| Decisão | Motivo |
|---|---|
| Não usar Cloudflare Tunnel em produção | O tráfego passaria por terceiro e o TLS terminaria na borda da Cloudflare. O escritório saiu de Vercel/Supabase justamente para tirar um processador externo do caminho. |
| HTTPS mesmo dentro da rede | O cookie de sessão sai com a flag `Secure`; navegador nenhum aceita cookie `Secure` sobre `http://` fora de `localhost`. Com TLS o cookie funciona **sem enfraquecer nada** — a alternativa seria desligar a flag e trafegar sessão em claro. |
| Certificado de CA interna (Caddy) | Sem internet, sem CA externa, renovação automática. Custa um passo único por estação: confiar na raiz. |
| Só o Caddy publica portas | App, Kong, Supabase Studio e Postgres ficam apenas dentro da rede do Docker. Da rede, só existe a porta 443. |
| Só `/auth/v1/*` sai para a rede | É a única coisa que o navegador precisa falar direto com o banco (a tela de recuperação de senha). REST, Storage e Studio não são alcançáveis de fora da máquina. |
| App em container com `restart: unless-stopped` | O sistema volta sozinho depois de um reboot, sem ninguém logar e clicar em nada. |

---

## Requisitos

- Windows 10/11 Pro, macOS ou Linux
- 16 GB de RAM (funciona com 8, fica apertado), 40 GB livres
- Docker Desktop instalado e configurado para **iniciar junto com o sistema**
- Node.js LTS (só para rodar o instalador)
- **IP fixo** ou reserva de DHCP para essa máquina

### Antes de instalar

1. **Criptografe o disco** (BitLocker no Windows Pro, FileVault no Mac). O
   servidor vai guardar dados de cliente; sem isso, o disco é o ponto fraco.
2. Defina o **IP fixo** e decida o nome pelo qual as pessoas vão acessar.
3. Se a máquina for compartilhada com outra função (folha de pagamento, por
   exemplo), confirme com quem cuida da rede — instalar o Docker Desktop no
   Windows liga o WSL2, que é uma mudança de superfície de ataque.

---

## Instalação

```bash
git clone https://github.com/alfredosilva87-dotcom/vat-erp-ireland.git
```

Depois, **como Administrador**, duplo clique em `selfhost\install-server.bat`
(no Mac/Linux: `node selfhost/scripts/install-server.js` com `sudo`, por causa
das portas 80/443).

Ele pergunta:

| Pergunta | O que responder |
|---|---|
| Endereço do servidor | O nome ou IP que as pessoas vão digitar. **Vai no certificado** — mudar depois exige reemitir. |
| E-mail e senha | A conta de administrador. |
| `GEMINI_API_KEY` | Chave de <https://aistudio.google.com>. |

Leva de 10 a 20 minutos: baixa as imagens, **compila a aplicação**, cria as
tabelas, carrega a base de alíquotas e o admin, e gera o certificado.

Portas alternativas (se a 443 já estiver em uso):

```bash
VATERP_HTTP_PORT=8080 VATERP_HTTPS_PORT=8443 node selfhost/scripts/install-server.js
```

---

## Confiar no certificado (uma vez por computador)

O instalador grava `selfhost/server/root-ca.crt`. Sem instalar esse arquivo, o
navegador mostra "conexão não é particular" em toda estação.

**Windows** — copie o arquivo para a máquina e, num PowerShell **como
Administrador**:

```powershell
Import-Certificate -FilePath .\root-ca.crt -CertStoreLocation Cert:\LocalMachine\Root
```

**macOS**:

```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain root-ca.crt
```

**Firefox** tem armazenamento próprio: Configurações → Certificados → Ver
certificados → Autoridades → Importar → marcar "Confiar para identificar sites".

> Se o escritório tem Active Directory, o caminho limpo é distribuir essa raiz
> por GPO em vez de máquina por máquina.

E o nome precisa resolver: reserva de DHCP + registro no DNS interno, ou uma
linha no `hosts` de cada estação.

---

## Uso diário

Não tem "abrir o sistema". Ele fica no ar. As pessoas acessam o endereço.

| Ação | Comando (na pasta do projeto, no servidor) |
|---|---|
| Ver o estado | `docker compose -f selfhost/docker/docker-compose.yml ps` |
| Ver os logs | `node selfhost/scripts/logs.js` |
| Parar | `node selfhost/scripts/stop.js` |
| Subir de novo | `cd selfhost/docker && docker compose up -d` |
| Backup | `node selfhost/scripts/backup.js` |

Depois de atualizar o código (`git pull`), a imagem precisa ser reconstruída:

```bash
cd selfhost/docker && docker compose up -d --build
```

### Abrir o painel do banco (Supabase Studio)

De propósito, ele **só responde na própria máquina**. Para abrir de outro
computador, faça um túnel em vez de publicar a porta:

```bash
ssh -L 8000:127.0.0.1:8000 usuario@servidor
```

Depois acesse `http://localhost:8000`. Usuário `supabase`, senha em
`DASHBOARD_PASSWORD` de `selfhost/docker/.env`.

---

## Backup

```bash
node selfhost/scripts/backup.js D:\backups-vat
```

Gera uma pasta datada com `banco.sql` e os arquivos das notas, e mantém as 14
mais recentes. Agende no **Agendador de Tarefas** do Windows para rodar todo
dia fora do horário comercial.

Três coisas que fazem a diferença entre ter backup e achar que tem:

1. **O destino precisa estar criptografado.** A pasta contém dados de cliente
   em texto. O script não criptografa de propósito — gerenciamento de chave mal
   feito é pior que nenhum. Use um disco com BitLocker ou o backup corporativo
   que o escritório já usa.
2. **Uma cópia fora desta máquina.** Backup no mesmo disco não protege contra
   perda do disco nem contra ransomware.
3. **Teste a restauração de verdade**, pelo menos uma vez. Backup nunca
   testado não é backup.

Para restaurar num servidor novo: instale do zero, pare o app
(`docker compose stop app`), aplique o `banco.sql`, copie a pasta `arquivos`
de volta para `selfhost/docker/volumes/storage/` e suba de novo.

---

## Teste com 3 máquinas (1 servidor + 2 estações)

O jeito de provar que o desenho serve para o escritório: instalar num notebook
Windows e acessar dele **e** de dois Macs ao mesmo tempo.

**No notebook Windows (o servidor):**

1. Descubra o IP: `ipconfig` → *IPv4 Address* (algo como `192.168.0.42`).
   Fixe esse IP no roteador (reserva de DHCP), senão ele muda e o certificado
   deixa de bater.
2. Instale Node.js LTS e Docker Desktop; abra o Docker e espere ficar *Running*.
3. Rode `selfhost\install-server.bat` **como Administrador** e responda o IP
   quando ele pedir o endereço.

   > Use o **IP**, não o nome da máquina. O nome depende de resolução de nomes
   > entre Windows e Mac, que é justamente o que costuma falhar num teste — e
   > você acaba caçando um problema de rede achando que é do sistema.

4. O instalador libera a porta 443 no firewall do Windows sozinho. Se ele
   avisar que não conseguiu, libere na mão antes de continuar.

**Nos dois Macs (as estações):**

1. Copie `selfhost/server/root-ca.crt` do servidor (pen drive, e-mail, pasta
   compartilhada — é um certificado público, não é segredo).
2. Instale:

   ```bash
   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain root-ca.crt
   ```

3. Abra `https://192.168.0.42` (o IP do servidor).

**O que testar com os três ligados:**

- [ ] Os dois Macs abrem a tela de login **sem aviso de certificado**.
- [ ] Login funciona e **continua logado** ao navegar. Se voltar para o login,
      o certificado não foi aceito.
- [ ] Crie um cliente no Mac 1 → ele aparece no Mac 2 (pode precisar recarregar).
- [ ] Suba uma nota no Mac 1 e abra o PDF dela no Mac 2.
- [ ] Suba notas nos dois Macs ao mesmo tempo e confira que nenhuma se perde.
- [ ] Crie um segundo usuário (Configurações → Usuários) e entre com ele no
      Mac 2, para testar duas pessoas de verdade e não o mesmo login duplicado.
- [ ] Feche tudo, **reinicie o notebook Windows**, espere, e acesse de novo dos
      Macs sem ninguém tocar no servidor.

Se esse roteiro passar, o desenho está provado — o que muda no escritório é só
qual máquina faz o papel de servidor.

## Checklist de validação (fazer depois de instalar)

No servidor:

- [ ] `https://<endereço>` abre a tela de login **sem aviso de certificado**.
- [ ] `http://<endereço>` redireciona para `https://`.
- [ ] O painel do banco **não** responde de outra máquina:
      `curl -m 5 http://<endereço>:8000` deve dar conexão recusada.

De uma estação (depois de instalar o certificado raiz):

- [ ] Login funciona e **permanece logado** ao navegar — se voltar para a tela
      de login, o certificado não foi aceito e o cookie está sendo descartado.
- [ ] Criar cliente, subir uma nota, abrir o PDF salvo.
- [ ] De uma **segunda** estação, com outro usuário: os mesmos dados aparecem.
      Este é o teste que a instalação por PC não passaria.

Resiliência:

- [ ] Reiniciar o servidor e conferir que tudo volta **sem ninguém tocar nele**.
- [ ] Rodar o backup, e restaurar num ambiente de teste para provar que presta.

## O que ainda depende de vocês

Coisas que este pacote não resolve e que fazem parte do desenho de segurança:

- **Reboot automático e energia** — é um notebook; confirme o que acontece ao
  fechar a tampa (Windows: "não fazer nada" quando ligado na tomada) e se ele
  volta sozinho após queda de energia.
- **Atualizações** das imagens do Docker e do sistema operacional.
- **Contas por pessoa** dentro do app (Configurações → Usuários), em vez de
  todo mundo usando o mesmo login. O app já tem perfis.
- **Acesso remoto por VPN**, se for necessário. Não publique o servidor.
- **Retenção de logs** do Caddy (`caddy-logs`) conforme a política do
  escritório.
