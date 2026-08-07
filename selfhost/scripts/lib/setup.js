"use strict";
/** Steps shared by the per-PC installer and the server installer. */
const fs = require("fs");
const path = require("path");

const {
  ROOT, DOCKER_DIR, PROJECT_NAME,
  step, ok, warn, fail, capture, psql, dollarQuote, waitFor, ask,
} = require("./proc");

const SCHEMA_DIR = path.join(ROOT, "selfhost", "schema");
const DB_DATA_DIR = path.join(DOCKER_DIR, "volumes", "db", "data");

/**
 * Decides where Postgres and Storage keep their data.
 *
 * New installs use Docker named volumes: on Windows a bind mount into the
 * project folder cannot express the ownership Postgres demands of its data
 * directory, and the database refuses to start. Installs made before that
 * change already have data in ./volumes/..., so those keep the bind mount —
 * an upgrade must never leave a working database behind and silently start an
 * empty one.
 */
function resolveDataSources() {
  const hasData = (dir) => {
    try {
      return fs.readdirSync(dir).length > 0;
    } catch {
      return false;
    }
  };

  const legacyDb = path.join(DOCKER_DIR, "volumes", "db", "data");
  const legacyStorage = path.join(DOCKER_DIR, "volumes", "storage");

  const sources = {
    PGDATA_SOURCE: hasData(legacyDb) ? "./volumes/db/data" : "db-data",
    STORAGE_SOURCE: hasData(legacyStorage) ? "./volumes/storage" : "storage-data",
  };

  if (sources.PGDATA_SOURCE !== "db-data") {
    warn("Banco existente encontrado em volumes/db/data — mantendo onde esta.");
  }
  return sources;
}

/**
 * Refuses to generate fresh secrets on top of an existing database.
 *
 * The Postgres superuser password lives in docker/.env, and the data directory
 * was initialised with it. If the .env is gone but the data is not, a new
 * install writes a new password and every service then fails authentication —
 * with errors ("password authentication failed for user supabase_auth_admin",
 * containers restart-looping) that give no hint that the cause is a lost file.
 * Better to stop here and say so.
 */
function refuseIfDataWithoutEnv({ envFile, dataDir }) {
  if (fs.existsSync(envFile)) return;

  // The database may live in the old bind mount or in the Docker volume.
  const inFolder = fs.existsSync(dataDir) && fs.readdirSync(dataDir).length > 0;
  const inVolume = capture("docker", ["volume", "inspect", `${PROJECT_NAME}_db-data`]).status === 0;
  if (!inFolder && !inVolume) return;

  const where = inFolder ? dataDir : `volume Docker "${PROJECT_NAME}_db-data"`;
  const howToWipe = inFolder
    ? `rm -rf "${dataDir}"`
    : `docker volume rm ${PROJECT_NAME}_db-data`;

  fail(
    "Existe um banco de dados, mas o arquivo de chaves sumiu.\n\n" +
    `  Banco:  ${where}\n` +
    `  Chaves: ${envFile} (nao encontrado)\n\n` +
    "  A senha do Postgres estava nesse arquivo. Gerar chaves novas agora\n" +
    "  deixaria o banco inacessivel. Escolha um caminho:\n\n" +
    "  1. Restaure o docker/.env do backup, se existir  (mantem os dados)\n" +
    "  2. Apague o banco e instale do zero              (PERDE os dados)\n\n" +
    `     Para o caminho 2:  ${howToWipe}`
  );
  process.exit(1);
}

/** Reads `KEY=value` lines out of an .env-style file. */
function readEnvValues(file) {
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_0-9]+)=(.*)$/.exec(line);
    if (m) values[m[1]] = m[2];
  }
  return values;
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

async function waitForDatabase(timeoutMs = 300000) {
  const ready = await waitFor("banco de dados", () => psql("select 1;").status === 0, { timeoutMs });
  if (!ready) {
    fail("O Postgres nao respondeu a tempo. Rode `node selfhost/scripts/logs.js` para ver o motivo.");
    process.exit(1);
  }
}

async function applySchema() {
  step("Criando as tabelas e a base de referencia (VAT / regras de credito)");
  applySqlFile("001_full_schema.sql");
  applySqlFile("002_seed_reference_data.sql");

  // storage-api creates its own `storage` schema on first boot; the bucket can
  // only be inserted after that has happened.
  const storageReady = await waitFor("servico de arquivos (storage)", () =>
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

/**
 * Admin credentials + Gemini key, from the environment when set (unattended
 * install) or asked interactively.
 */
async function collectCredentials({ dim }) {
  let email = process.env.VATERP_ADMIN_EMAIL;
  let password = process.env.VATERP_ADMIN_PASSWORD;
  let geminiKey = process.env.VATERP_GEMINI_KEY;

  if (email && password) {
    step("Dados do administrador (vindos das variaveis de ambiente)");
    ok(email);
    if (password.length < 8) {
      fail("VATERP_ADMIN_PASSWORD precisa de pelo menos 8 caracteres.");
      process.exit(1);
    }
  } else {
    step("Dados do administrador");
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
    console.log(dim("    Pode deixar em branco agora e preencher depois."));
    geminiKey = await ask("  GEMINI_API_KEY: ", { required: false });
  }

  geminiKey = geminiKey || "";
  if (!geminiKey) warn("Sem a chave Gemini, a leitura automatica de notas nao funciona (o resto funciona).");
  return { email, password, geminiKey };
}

module.exports = {
  SCHEMA_DIR,
  resolveDataSources,
  DB_DATA_DIR,
  refuseIfDataWithoutEnv,
  readEnvValues,
  applySqlFile,
  waitForDatabase,
  applySchema,
  createAdmin,
  collectCredentials,
};
