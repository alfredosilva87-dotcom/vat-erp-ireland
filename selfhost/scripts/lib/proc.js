"use strict";
/**
 * Thin process / prompt helpers shared by the install and start scripts.
 *
 * Commands run without a shell. The one exception is npm, which on Windows is
 * npm.cmd and only resolves through the shell — see `npmRun`. No user-supplied
 * value is ever interpolated into a command line anyway: passwords and SQL
 * always travel over stdin.
 */
const { spawnSync } = require("child_process");
const path = require("path");
const readline = require("readline");

const ROOT = path.resolve(__dirname, "..", "..", ".."); // repo root
const SELFHOST = path.join(ROOT, "selfhost");
const DOCKER_DIR = path.join(SELFHOST, "docker");

const ESC = "\u001b";
const USE_COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const color = (code) => (s) => (USE_COLOR ? `${ESC}[${code}m${s}${ESC}[0m` : String(s));
const bold = color("1");
const dim = color("2");
const red = color("31");
const green = color("32");
const yellow = color("33");
const cyan = color("36");
const CLEAR_LINE = `\r${ESC}[K`;

function step(msg) {
  console.log(`\n${cyan("▸")} ${bold(msg)}`);
}
function ok(msg) {
  console.log(`  ${green("OK")} ${msg}`);
}
function warn(msg) {
  console.log(`  ${yellow("!")}  ${msg}`);
}
function fail(msg) {
  console.error(`\n${red("ERRO")} ${msg}\n`);
}

/** Runs a command, streaming its output. Returns the spawn result. */
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: "inherit", ...opts });
}

/** Runs a command and captures stdout. */
function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { status: r.status, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

/** npm is npm.cmd on Windows, which only resolves through a shell. */
function npmRun(args, opts = {}) {
  const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return run(cmd, args, { shell: process.platform === "win32", ...opts });
}

function commandExists(cmd, args = ["--version"]) {
  return capture(cmd, args).status === 0;
}

/**
 * Compose v2 (`docker compose`) is the shipped default; the standalone
 * `docker-compose` binary is still what some older Windows installs have.
 */
let composeBaseCache;
function composeBase() {
  if (composeBaseCache !== undefined) return composeBaseCache;
  if (capture("docker", ["compose", "version"]).status === 0) composeBaseCache = ["docker", ["compose"]];
  else if (capture("docker-compose", ["version"]).status === 0) composeBaseCache = ["docker-compose", []];
  else composeBaseCache = null;
  return composeBaseCache;
}

function requireCompose() {
  const base = composeBase();
  if (!base) throw new Error("Docker Compose nao encontrado. Instale/abra o Docker Desktop e tente de novo.");
  return base;
}

function compose(args, opts = {}) {
  const base = requireCompose();
  return run(base[0], [...base[1], ...args], { cwd: DOCKER_DIR, ...opts });
}

function composeCapture(args, opts = {}) {
  const base = requireCompose();
  return capture(base[0], [...base[1], ...args], { cwd: DOCKER_DIR, ...opts });
}

/**
 * Feeds SQL to psql inside the `db` container over stdin.
 *
 * `postgres` is the everyday role but it is NOT a superuser in the Supabase
 * image — objects owned by the service roles (storage in particular) need
 * `supabase_admin`, which is.
 */
function psql(sql, { quiet = true, user = "postgres" } = {}) {
  const base = requireCompose();
  const args = [
    ...base[1],
    "exec", "-T", "db",
    "psql", "-U", user, "-d", "postgres",
    "-v", "ON_ERROR_STOP=1",
    ...(quiet ? ["-q", "-t", "-A"] : []),
    "-f", "-",
  ];
  return capture(base[0], args, { cwd: DOCKER_DIR, input: sql });
}

/** Quotes a string as a Postgres dollar-quoted literal — no escaping needed. */
function dollarQuote(value) {
  let tag = "q";
  while (value.includes(`$${tag}$`)) tag += "q";
  return `$${tag}$${value}$${tag}$`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Retries `fn` until it returns truthy or the budget runs out. */
async function waitFor(label, fn, { timeoutMs = 240000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`  ${dim(`aguardando ${label}`)}`);
  while (Date.now() < deadline) {
    let hit = false;
    try {
      hit = await fn();
    } catch {
      hit = false;
    }
    if (hit) {
      process.stdout.write(CLEAR_LINE);
      ok(`${label} pronto`);
      return true;
    }
    process.stdout.write(".");
    await sleep(intervalMs);
  }
  process.stdout.write(CLEAR_LINE);
  return false;
}

function ask(prompt, { hidden = false, required = true, defaultValue = "" } = {}) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let answered = false;

    if (hidden) {
      // Suppress echo of the typed characters, but keep the prompt visible.
      rl._writeToOutput = function (chunk) {
        if (rl.stdoutMuted && !chunk.startsWith(prompt)) return;
        rl.output.write(chunk);
      };
      rl.stdoutMuted = true;
    }

    // Ctrl+D / a closed pipe must end the run, not spin forever on a required
    // field that can no longer be filled.
    rl.on("close", () => {
      if (!answered) reject(new Error("Entrada encerrada antes de responder. Instalacao cancelada."));
    });

    rl.question(prompt, (answer) => {
      answered = true;
      if (hidden) rl.output.write("\n");
      rl.close();
      const value = answer.trim() || defaultValue;
      if (required && !value) {
        warn("Campo obrigatorio.");
        return resolve(ask(prompt, { hidden, required, defaultValue }));
      }
      resolve(value);
    });
  });
}

async function confirm(prompt, { defaultYes = false } = {}) {
  const suffix = defaultYes ? " [S/n] " : " [s/N] ";
  const answer = (await ask(prompt + suffix, { required: false })).toLowerCase();
  if (!answer) return defaultYes;
  return answer === "s" || answer === "y" || answer === "sim";
}

module.exports = {
  ROOT, SELFHOST, DOCKER_DIR,
  bold, dim, red, green, yellow, cyan,
  step, ok, warn, fail,
  run, capture, npmRun, commandExists,
  compose, composeCapture, composeBase,
  psql, dollarQuote,
  sleep, waitFor, ask, confirm,
};
