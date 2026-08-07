"use strict";
/**
 * Day-to-day launcher: makes sure Docker is up, brings the stack back, waits
 * for the database, opens the browser and then runs the Next.js server in the
 * foreground. Closing the window stops the app; the database keeps running
 * until `stop` is used, which is what makes a sign-out / sign-in round trip
 * behave the way it does on a real server.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const {
  ROOT, bold, dim, cyan,
  step, ok, fail, npmRun, capture, compose, composeBase,
  psql, waitFor,
} = require("./lib/proc");
const { readConfig } = require("./lib/ports");

function openBrowser(url) {
  const cmd =
    process.platform === "win32" ? ["cmd", ["/c", "start", '""', url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true, shell: false }).unref();
  } catch {
    /* opening a browser is a convenience, never a reason to fail the start */
  }
}

async function main() {
  console.log(`\n${bold("VAT ERP Ireland")} ${dim("— iniciando")}\n`);

  if (!fs.existsSync(path.join(ROOT, ".env.local"))) {
    fail("Este computador ainda nao foi instalado. Rode o install primeiro.");
    process.exit(1);
  }
  const ports = readConfig() || { appPort: 3000, apiPort: 8000 };
  const appUrl = `http://localhost:${ports.appPort}`;
  if (!composeBase() || capture("docker", ["info"]).status !== 0) {
    fail(
      "O Docker nao esta rodando.\n" +
      "  Abra o Docker Desktop, espere ficar verde (Running) e tente de novo."
    );
    process.exit(1);
  }

  step("Banco de dados");
  if (compose(["up", "-d"], { stdio: "ignore" }).status !== 0) {
    fail("Nao consegui subir os containers.");
    process.exit(1);
  }
  const ready = await waitFor("banco de dados", () => psql("select 1;").status === 0, {
    timeoutMs: 180000,
  });
  if (!ready) {
    fail("O banco nao respondeu. Rode `logs` para ver o motivo.");
    process.exit(1);
  }

  if (!fs.existsSync(path.join(ROOT, ".next"))) {
    step("Compilando a aplicacao (primeira vez apos uma atualizacao)");
    if (npmRun(["run", "build"], { cwd: ROOT }).status !== 0) {
      fail("`npm run build` falhou.");
      process.exit(1);
    }
  }

  step("Aplicacao");
  ok(`abrindo ${cyan(appUrl)}`);
  console.log(dim("\n  Para PARAR o app: feche esta janela (ou Ctrl+C).\n"));
  setTimeout(() => openBrowser(appUrl), 2500);

  // Foreground on purpose — the window staying open is the user's "on" light.
  const r = npmRun(["run", "start", "--", "-p", String(ports.appPort)], { cwd: ROOT });
  process.exit(r.status ?? 0);
}

main().catch((err) => {
  fail(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
