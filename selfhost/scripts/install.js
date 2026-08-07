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
  psql, dollarQuote, waitFor, ask,
} = require("./lib/proc");
const { generate, applyToEnvFile } = require("./lib/secrets");
const { pickPort, readConfig, writeConfig } = require("./lib/ports");

const SCHEMA_DIR = path.join(ROOT, "selfhost", "schema");
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

function readEnvValues(file) {
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_0-9]+)=(.*)$/.exec(line);
    if (m) values[m[1]] = m[2];
  }
  return values;
}

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

  const dbReady = await waitFor("banco de dados", () => psql("select 1;").status === 0, {
    timeoutMs: 300000,
  });
  if (!dbReady) {
    fail("O Postgres nao respondeu a tempo. Rode `selfhost/scripts/logs` para ver o motivo.");
    process.exit(1);
  }
}

function applySqlFile(file, opts = {}) {
  const sql = fs.readFileSync(path.join(SCHEMA_DIR, file), "utf8");
  const r = psql(sql, opts);
  if (r.status !== 0) {
    fail(`Erro aplicando ${file}:\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
  ok(file);
}

async function applySchema() {
  step("Criando as tabelas e a base de referencia (VAT / regras de credito)");
  applySqlFile("001_full_schema.sql");
  applySqlFile("002_seed_reference_data.sql");

  // storage-api creates its own `storage` schema on first boot; the bucket can
  // only be inserted after that has happened.
  const storageReady = await waitFor(
    "servico de arquivos (storage)",
    () =>
      psql(
        "select 1 from information_schema.tables where table_schema='storage' and table_name='buckets';"
      ).stdout.trim() === "1"
  );
  if (!storageReady) {
    warn("O storage demorou demais. O app sobe, mas o upload de PDF pode falhar.");
    warn("Rode o instalador de novo depois que os containers estiverem estaveis.");
    return;
  }
  // storage.buckets belongs to supabase_storage_admin; only supabase_admin
  // (the actual superuser here) can write to it.
  applySqlFile("003_storage_bucket.sql", { user: "supabase_admin" });
}

async function createAdmin({ email, password }) {
  step("Criando o usuario administrador");

  // bcrypt via pgcrypto: the password never leaves this machine and never
  // touches a command line. bcryptjs (used by lib/auth.ts) verifies $2a$ fine.
  const sql = `
do $do$
declare
  v_company uuid;
begin
  select id into v_company from companies where slug = 'precisetax';

  insert into app_users (email, name, password_hash, role, active, must_change, company_id)
  values (
    lower(${dollarQuote(email)}),
    'Administrador',
    crypt(${dollarQuote(password)}, gen_salt('bf', 10)),
    'admin',
    true,
    false,
    v_company
  )
  on conflict (email) do update
    set password_hash = excluded.password_hash,
        role          = 'admin',
        active        = true,
        must_change   = false,
        company_id    = coalesce(app_users.company_id, excluded.company_id);
end
$do$;
`;
  const r = psql(sql);
  if (r.status !== 0) {
    fail(`Nao consegui criar o administrador:\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
  ok(`administrador: ${email}`);
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

  // Env vars let the install run unattended (office server, re-imaging a PC).
  // When they are absent — the normal case — everything is asked here.
  let email = process.env.VATERP_ADMIN_EMAIL;
  let password = process.env.VATERP_ADMIN_PASSWORD;
  let geminiKey = process.env.VATERP_GEMINI_KEY;
  const unattended = Boolean(email && password);

  if (unattended) {
    step("Dados do administrador (vindos das variaveis de ambiente)");
    ok(email);
    if (password.length < 8) {
      fail("VATERP_ADMIN_PASSWORD precisa de pelo menos 8 caracteres.");
      process.exit(1);
    }
  } else {
    step("Dados do administrador deste computador");
    console.log(dim("    E o login que voce vai usar para entrar no sistema."));
    email = await ask("  E-mail: ");
    for (;;) {
      password = await ask("  Senha: ", { hidden: true });
      if (password.length < 8) {
        warn("Use pelo menos 8 caracteres.");
        continue;
      }
      const again = await ask("  Repita a senha: ", { hidden: true });
      if (again === password) break;
      warn("As senhas nao conferem.");
    }

    step("Chave de leitura das notas (Google Gemini)");
    console.log(dim("    Pegue uma chave gratuita em https://aistudio.google.com -> Get API key"));
    console.log(dim("    Pode deixar em branco agora e preencher depois no arquivo .env.local."));
    geminiKey = await ask("  GEMINI_API_KEY: ", { required: false });
  }
  geminiKey = geminiKey || "";
  if (!geminiKey) warn("Sem a chave Gemini, a leitura automatica de notas nao funciona (o resto funciona).");

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
