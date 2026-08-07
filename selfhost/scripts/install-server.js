"use strict";
/**
 * Installer for the shared office server: one machine, many people, one set of
 * data, reachable over HTTPS on the local network.
 *
 * Differences from install.js (the per-PC install):
 *   - the app runs as a container with `restart: unless-stopped`, so a reboot
 *     brings the system back without anyone logging in and clicking anything;
 *   - Caddy terminates TLS with its own internal CA, which is what makes the
 *     `Secure` session cookie work off-machine;
 *   - only ports 80 and 443 are published — the app, Kong, Studio and Postgres
 *     stay inside the Docker network.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  DOCKER_DIR,
  bold, dim, cyan,
  step, ok, warn, fail,
  capture, compose, composeBase,
  ask,
} = require("./lib/proc");
const { generate, applyToEnvFile } = require("./lib/secrets");
const {
  readEnvValues, waitForDatabase, applySchema, createAdmin, collectCredentials,
  refuseIfDataWithoutEnv, DB_DATA_DIR, resolveDataSources,
} = require("./lib/setup");
const { exportCa } = require("./lib/ca");
const { openWindowsPort } = require("./lib/firewall");
const { pickPort } = require("./lib/ports");

const ENV_EXAMPLE = path.join(DOCKER_DIR, ".env.example");
const ENV_DOCKER = path.join(DOCKER_DIR, ".env");

const COMPOSE_FILES = "docker-compose.yml:docker-compose.override.yml:../server/docker-compose.server.yml";

function banner() {
  console.log(`
${bold("VAT ERP Ireland — instalacao do SERVIDOR")}
${dim("Um servidor, varias pessoas, os mesmos dados. HTTPS na rede local.")}
${dim("Nada e publicado na internet.")}
`);
}

function checkPrereqs() {
  step("Verificando o que ja esta instalado");

  if (!composeBase()) {
    fail(
      "Docker nao encontrado.\n" +
      "  Instale o Docker Desktop em https://docs.docker.com/desktop/, abra o\n" +
      "  programa, espere ficar verde (Running) e rode este instalador de novo."
    );
    process.exit(1);
  }
  const info = capture("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (info.status !== 0) {
    fail("O Docker esta instalado mas nao esta rodando. Abra o Docker Desktop e tente de novo.");
    process.exit(1);
  }
  ok(`Docker ${info.stdout}`);

  const totalGb = os.totalmem() / 1024 ** 3;
  if (totalGb < 7.5) warn(`Servidor com ${totalGb.toFixed(1)} GB de RAM — o recomendado e 16 GB ou mais.`);
  else ok(`RAM: ${totalGb.toFixed(0)} GB`);
}

/**
 * The name people will type in the browser. It has to match the certificate,
 * so it is fixed at install time and changing it later means reissuing.
 */
async function askServerHost() {
  const fromEnv = process.env.VATERP_SERVER_HOST;
  if (fromEnv) {
    step("Endereco do servidor (variavel de ambiente)");
    ok(fromEnv);
    return fromEnv;
  }

  step("Endereco do servidor");
  console.log(dim("    E o que as pessoas vao digitar no navegador, e o nome que vai"));
  console.log(dim("    no certificado. Use o nome da maquina na rede ou o IP fixo dela."));
  console.log(dim(`    Sugestao: ${os.hostname().split(".")[0].toLowerCase()}`));
  return await ask("  Endereco: ", { defaultValue: os.hostname().split(".")[0].toLowerCase() });
}

/**
 * Kong is published on the loopback only, so an admin can open Supabase Studio
 * on the server itself. The stock 8000/8443 are a common collision (another
 * Supabase stack, another dev tool), and a collision here aborts the whole
 * install after the image build — so the ports are picked free, and never the
 * ones Caddy is about to take.
 */
async function resolveKongPorts(taken) {
  const free = async (from) => {
    let port = from;
    for (;;) {
      port = await pickPort(port, { step: 1 });
      if (!taken.includes(port)) return port;
      port += 1;
    }
  };
  const http = await free(8000);
  const https = await free(Math.max(8443, http + 1));
  if (http !== 8000 || https !== 8443) {
    warn(`portas 8000/8443 ocupadas — Studio local em 127.0.0.1:${http}`);
  }
  return { http, https };
}

/** `https://host`, or `https://host:porta` quando o proxy nao esta na 443. */
function publicUrlFor(serverHost, httpsPort) {
  return httpsPort === 443 ? `https://${serverHost}` : `https://${serverHost}:${httpsPort}`;
}

function ensureDockerEnv({ serverHost, geminiKey, httpPort, httpsPort, kongPorts }) {
  step("Preparando as chaves de seguranca");

  refuseIfDataWithoutEnv({ envFile: ENV_DOCKER, dataDir: DB_DATA_DIR });

  const fresh = !fs.existsSync(ENV_DOCKER);
  let body;
  let secrets;

  if (fresh) {
    secrets = generate();
    body = applyToEnvFile(fs.readFileSync(ENV_EXAMPLE, "utf8"), secrets);
    ok("chaves geradas (nunca vao para o git)");
  } else {
    body = fs.readFileSync(ENV_DOCKER, "utf8");
    const existing = readEnvValues(ENV_DOCKER);
    secrets = { AUTH_SECRET: existing.AUTH_SECRET || generate().AUTH_SECRET };
    ok("docker/.env ja existe — reaproveitando as chaves atuais");
    console.log(dim("    (gerar chaves novas invalidaria o banco que ja esta neste servidor)"));
  }

  const publicUrl = publicUrlFor(serverHost, httpsPort);
  body = applyToEnvFile(body, {
    COMPOSE_FILE: COMPOSE_FILES,
    // Kong is not published to the network here; Caddy reaches it over the
    // Docker network. The loopback binding stays so an admin can open Studio
    // on the server itself.
    SUPABASE_PUBLIC_URL: publicUrl,
    API_EXTERNAL_URL: `${publicUrl}/auth/v1`,
    SITE_URL: publicUrl,
  });

  // Values the app container needs, which are not part of the stock file.
  const extras = {
    ...resolveDataSources(),
    COMPOSE_PROJECT_NAME: "vat-erp",
    COMPOSE_PATH_SEPARATOR: ":",
    SERVER_HOST: serverHost,
    PUBLIC_ORIGIN: publicUrl,
    CADDY_HTTP_PORT: String(httpPort),
    CADDY_HTTPS_PORT: String(httpsPort),
    KONG_HTTP_PORT: String(kongPorts.http),
    KONG_HTTPS_PORT: String(kongPorts.https),
    AUTH_SECRET: secrets.AUTH_SECRET,
    GEMINI_API_KEY: geminiKey,
    GEMINI_MODEL: "gemini-flash-latest",
  };
  for (const [key, value] of Object.entries(extras)) {
    const line = new RegExp(`^${key}=.*$`, "m");
    body = line.test(body) ? body.replace(line, `${key}=${value}`) : `${body}\n${key}=${value}`;
  }

  fs.writeFileSync(ENV_DOCKER, `${body.replace(/\n+$/, "")}\n`, { mode: 0o600 });
  ok(`endereco do servidor: ${publicUrl}`);
  return readEnvValues(ENV_DOCKER);
}

function startStack() {
  step("Construindo a imagem da aplicacao e subindo o servidor");
  console.log(dim("    A primeira vez leva 10-20 minutos (download das imagens + build)."));

  if (compose(["up", "-d", "--build"]).status !== 0) {
    fail("Falha ao subir o servidor. Veja a mensagem do Docker acima.");
    process.exit(1);
  }
}

async function exportRootCa() {
  step("Exportando o certificado raiz para as estacoes");
  const done = await exportCa();
  if (!done) {
    warn("Nao consegui exportar o certificado agora (o Caddy ainda esta subindo).");
    warn("Rode `node selfhost/scripts/export-ca.js` daqui a pouco.");
  }
  return done;
}

async function main() {
  banner();
  checkPrereqs();

  const serverHost = await askServerHost();
  const httpPort = Number(process.env.VATERP_HTTP_PORT || 80);
  const httpsPort = Number(process.env.VATERP_HTTPS_PORT || 443);
  const { email, password, geminiKey } = await collectCredentials({ dim });

  const kongPorts = await resolveKongPorts([httpPort, httpsPort]);
  ensureDockerEnv({ serverHost, geminiKey, httpPort, httpsPort, kongPorts });
  openWindowsPort(httpsPort);
  startStack();
  await waitForDatabase();
  await applySchema();
  await createAdmin({ email, password });
  const caOk = await exportRootCa();

  console.log(`
${bold("Servidor instalado.")}

  Endereco:  ${cyan(publicUrlFor(serverHost, httpsPort))}
  Login:     ${email}

  O servidor sobe sozinho quando a maquina liga (enquanto o Docker Desktop
  estiver configurado para iniciar junto com o Windows).

${bold("Falta um passo em CADA computador que vai usar o sistema:")}
  ${caOk ? `instalar o certificado ${cyan("selfhost/server/root-ca.crt")}` : "exportar e instalar o certificado raiz"}
  Sem isso o navegador mostra aviso de site nao seguro.
  O passo a passo esta em ${cyan("selfhost/SERVIDOR.md")}.

${dim("Backup: node selfhost/scripts/backup.js  (configure para rodar todo dia)")}
`);
}

main().catch((err) => {
  fail(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
