"use strict";
/**
 * One-shot installer for the self-hosted VAT ERP.
 *
 * Brings up a local Supabase stack (Postgres + PostgREST + Storage + GoTrue +
 * Studio) in Docker, applies the schema and the reference data, creates the
 * admin account from what is typed here, then builds the Next.js app. Written
 * in Node rather than shell so that Windows and macOS run the same code path —
 * Node is a hard requirement of the app anyway.
 *
 * Safe to re-run: every SQL step is idempotent, and an existing docker/.env is
 * reused by default (regenerating it would orphan the Postgres data volume,
 * whose superuser password came from the old file).
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  ROOT, DOCKER_DIR,
  bold, dim, cyan,
  step, ok, warn, fail,
  npmRun, capture, compose, composeBase,

} = require("./lib/proc");
const { generate, applyToEnvFile } = require("./lib/secrets");
const { pickPort, readConfig, writeConfig } = require("./lib/ports");
const {
  readEnvValues, waitForDatabase, applySchema, createAdmin, collectCredentials,
} = require("./lib/setup");

const ENV_EXAMPLE = path.join(DOCKER_DIR, ".env.example");
const ENV_DOCKER = path.join(DOCKER_DIR, ".env");
const ENV_APP = path.join(ROOT, ".env.local");

function banner() {
  console.log(`
${bold("VAT ERP Ireland — instalacao local (self-hosted)")}
${dim("Banco de dados, arquivos e aplicacao rodam 100% neste computador.")}
${dim("Nada e enviado para a nuvem.")}
`);
}

// ---------------------------------------------------------------- pre-flight

function checkPrereqs() {
  step("Verificando o que ja esta instalado");

  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) {
    fail(`Node.js ${process.versions.node} e muito antigo. Instale a versao LTS em https://nodejs.org`);
    process.exit(1);
  }
  ok(`Node.js ${process.versions.node}`);

  if (!composeBase()) {
    fail(
      "Docker nao encontrado.\n" +
      "  Windows/Mac: instale o Docker Desktop em https://docs.docker.com/desktop/\n" +
      "  Depois abra o Docker Desktop, espere ficar verde (Running) e rode este instalador de novo."
    );
    process.exit(1);
  }

  const info = capture("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (info.status !== 0) {
    fail(
      "O Docker esta instalado mas nao esta rodando.\n" +
      "  Abra o Docker Desktop, espere ficar verde (Running) e rode este instalador de novo."
    );
    process.exit(1);
  }
  ok(`Docker ${info.stdout}`);

  const totalGb = os.totalmem() / 1024 ** 3;
  if (totalGb < 7.5) {
    warn(`Este PC tem ${totalGb.toFixed(1)} GB de RAM. O recomendado e 8 GB ou mais — pode ficar lento.`);
  }
}

// ------------------------------------------------------------------- secrets

/**
 * Picks the host ports once and remembers them. Re-running the installer must
 * not move a working install to a different address.
 */
async function resolvePorts() {
  const saved = readConfig();
  if (saved && saved.appPort && saved.apiPort) {
    ok(`portas ja definidas: app ${saved.appPort}, api ${saved.apiPort}`);
    return saved;
  }

  // config.json gone but the stack already configured: docker/.env is the
  // authority, and picking fresh ports here would silently point the app at an
  // address the containers do not listen on.
  if (fs.existsSync(ENV_DOCKER)) {
    const env = readEnvValues(ENV_DOCKER);
    const apiPort = Number(env.KONG_HTTP_PORT);
    if (apiPort) {
      const config = {
        appPort: await pickPort(3000),
        apiPort,
        apiHttpsPort: Number(env.KONG_HTTPS_PORT) || 8443,
      };
      writeConfig(config);
      ok(`portas recuperadas de docker/.env: app ${config.appPort}, api ${apiPort}`);
      return config;
    }
  }

  const appPort = await pickPort(3000);
  const apiPort = await pickPort(8000);
  const apiHttpsPort = await pickPort(8443);
  const config = { appPort, apiPort, apiHttpsPort };
  writeConfig(config);
  if (appPort !== 3000 || apiPort !== 8000) {
    warn(`portas padrao ocupadas — usando app ${appPort}, api ${apiPort}`);
  } else {
    ok(`portas: app ${appPort}, api ${apiPort}`);
  }
  return config;
}

async function ensureDockerEnv(ports) {
  step("Preparando as chaves de seguranca");

  if (fs.existsSync(ENV_DOCKER)) {
    ok("docker/.env ja existe — reaproveitando as chaves atuais");
    console.log(dim("    (gerar chaves novas invalidaria o banco de dados que ja esta neste PC)"));
    return readEnvValues(ENV_DOCKER);
  }

  const secrets = generate();
  let body = fs.readFileSync(ENV_EXAMPLE, "utf8");
  body = applyToEnvFile(body, secrets);
  body = applyToEnvFile(body, {
    // The stock example pins COMPOSE_FILE to a single file, which would make
    // Compose ignore our override (the one that trims unused services).
    COMPOSE_FILE: "docker-compose.yml:docker-compose.override.yml",
    KONG_HTTP_PORT: String(ports.apiPort),
    KONG_HTTPS_PORT: String(ports.apiHttpsPort),
    SUPABASE_PUBLIC_URL: apiUrl(ports),
    API_EXTERNAL_URL: `${apiUrl(ports)}/auth/v1`,
    SITE_URL: appUrl(ports),
  });
  body +=
    "\n# Fixado pelo instalador do VAT ERP.\n" +
    "# COMPOSE_PROJECT_NAME isola estes containers de qualquer outro stack Supabase\n" +
    "# na mesma maquina (sem isto o Compose usaria o nome da pasta, \"docker\").\n" +
    "COMPOSE_PROJECT_NAME=vat-erp\n" +
    "# Explicito para a lista em COMPOSE_FILE ser lida igual no Windows.\n" +
    "COMPOSE_PATH_SEPARATOR=:\n";

  fs.writeFileSync(ENV_DOCKER, body, { mode: 0o600 });
  ok("chaves geradas em selfhost/docker/.env (nunca vai para o git)");
  return readEnvValues(ENV_DOCKER);
}

const appUrl = (ports) => `http://localhost:${ports.appPort}`;
const apiUrl = (ports) => `http://localhost:${ports.apiPort}`;

function writeAppEnv(dockerEnv, ports, gemini) {
  step("Escrevendo a configuracao da aplicacao (.env.local)");

  if (fs.existsSync(ENV_APP)) {
    const backup = `${ENV_APP}.backup-${Date.now()}`;
    fs.copyFileSync(ENV_APP, backup);
    warn(`.env.local ja existia — copia guardada em ${path.basename(backup)}`);
  }

  const previous = fs.existsSync(ENV_APP) ? readEnvValues(ENV_APP) : {};
  // Reusing an existing AUTH_SECRET only avoids signing everyone out on re-run.
  const authSecret = previous.AUTH_SECRET || generate().AUTH_SECRET;

  const body = [
    "# Gerado por selfhost/scripts/install.js — nao versionar.",
    "",
    "# Motor de leitura das notas (Google Gemini)",
    `GEMINI_API_KEY=${gemini.key}`,
    `GEMINI_MODEL=${gemini.model}`,
    "",
    "# Supabase self-hosted rodando no Docker deste PC",
    `NEXT_PUBLIC_SUPABASE_URL=${apiUrl(ports)}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${dockerEnv.ANON_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY=${dockerEnv.SERVICE_ROLE_KEY}`,
    "",
    "# Assinatura do cookie de sessao",
    `AUTH_SECRET=${authSecret}`,
    "",
  ].join("\n");

  fs.writeFileSync(ENV_APP, body, { mode: 0o600 });
  ok(".env.local escrito");
}

// --------------------------------------------------------------------- stack

async function startStack() {
  step("Subindo o banco de dados e os servicos (Docker)");
  console.log(dim("    Na primeira vez o download das imagens leva alguns minutos."));

  const up = compose(["up", "-d"]);
  if (up.status !== 0) {
    fail("Falha ao subir os containers. Veja a mensagem do Docker acima.");
    process.exit(1);
  }

  await waitForDatabase();
}

// ----------------------------------------------------------------------- app

function buildApp() {
  step("Instalando as dependencias da aplicacao");
  if (npmRun(["install", "--no-audit", "--no-fund"], { cwd: ROOT }).status !== 0) {
    fail("`npm install` falhou.");
    process.exit(1);
  }
  ok("dependencias instaladas");

  step("Compilando a aplicacao (build de producao)");
  console.log(dim("    Leva 1-3 minutos. E o que deixa o app rapido no dia a dia."));
  if (npmRun(["run", "build"], { cwd: ROOT }).status !== 0) {
    fail("`npm run build` falhou.");
    process.exit(1);
  }
  ok("build concluido");
}

// -------------------------------------------------------------------- driver

async function main() {
  banner();
  checkPrereqs();

  const { email, password, geminiKey } = await collectCredentials({ dim });

  step("Escolhendo as portas");
  const ports = await resolvePorts();

  const dockerEnv = await ensureDockerEnv(ports);
  writeAppEnv(dockerEnv, ports, { key: geminiKey, model: "gemini-flash-latest" });

  await startStack();
  await applySchema();
  await createAdmin({ email, password });
  buildApp();

  const start = process.platform === "win32" ? "selfhost\\start.bat" : "selfhost/start.command";
  console.log(`
${bold("Instalacao concluida.")}

  Para usar o sistema:  ${cyan(start)}   (duplo clique)
  Endereco:             ${cyan(appUrl(ports))}
  Login:                ${email}

  Painel do banco (Supabase Studio): ${apiUrl(ports)}
  usuario ${dockerEnv.DASHBOARD_USERNAME} / senha em selfhost/docker/.env (DASHBOARD_PASSWORD)

${dim("Os dados ficam em selfhost/docker/volumes/. Nao apague essa pasta.")}
`);
}

main().catch((err) => {
  fail(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
