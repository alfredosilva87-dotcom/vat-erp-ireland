"use strict";
/**
 * Backup: the database as SQL plus the invoice files, into one dated folder.
 *
 * Deliberately plain files rather than an encrypted archive — key management
 * done badly is worse than none, and the honest answer is that the backup
 * destination must itself be encrypted (BitLocker / FileVault / an encrypted
 * external drive). See SERVIDOR.md.
 *
 *   node selfhost/scripts/backup.js [pasta-de-destino]
 *
 * Default destination: selfhost/backups/
 */
const fs = require("fs");
const path = require("path");

const {
  DOCKER_DIR, ROOT, bold, dim, cyan,
  step, ok, warn, fail, capture, composeBase,
} = require("./lib/proc");

const KEEP = 14; // dated folders kept before the oldest is dropped

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function dumpDatabase(target) {
  const base = composeBase();
  // supabase_admin is the superuser in this image; `postgres` cannot read the
  // storage schema, and the file metadata lives there.
  const r = capture(
    base[0],
    [
      ...base[1],
      "exec", "-T", "db",
      "pg_dump", "-U", "supabase_admin", "-d", "postgres",
      "--schema=public", "--schema=storage",
      "--no-owner", "--no-privileges",
    ],
    { cwd: DOCKER_DIR, maxBuffer: 1024 * 1024 * 512 }
  );
  if (r.status !== 0 || !r.stdout.includes("PostgreSQL database dump")) {
    fail(`pg_dump falhou:\n${r.stderr || "(sem saida)"}`);
    process.exit(1);
  }
  const file = path.join(target, "banco.sql");
  fs.writeFileSync(file, r.stdout);
  const mb = (fs.statSync(file).size / 1024 ** 2).toFixed(1);
  ok(`banco.sql (${mb} MB)`);
}

/**
 * Pulls the invoice files out of the storage container.
 *
 * Copying from the container rather than from a folder on disk is what makes
 * this work regardless of where the data actually lives — a Docker named
 * volume (the default) or the older ./volumes/storage bind mount.
 */
function copyFiles(target) {
  const base = composeBase();
  const dest = path.join(target, "arquivos");
  fs.mkdirSync(dest, { recursive: true });

  const r = capture(
    base[0],
    [...base[1], "cp", "storage:/var/lib/storage/.", dest],
    { cwd: DOCKER_DIR }
  );
  if (r.status !== 0) {
    warn(`Nao consegui copiar os arquivos das notas: ${r.stderr || r.stdout}`);
    return;
  }

  let count = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else count++;
    }
  };
  walk(dest);
  if (count === 0) warn("Ainda nao ha arquivos de nota para copiar.");
  else ok(`arquivos/ (${count} arquivo(s))`);
}

/** Keeps the backup folder from growing without bound. */
function prune(root) {
  const dated = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_/.test(e.name))
    .map((e) => e.name)
    .sort();
  for (const old of dated.slice(0, Math.max(0, dated.length - KEEP))) {
    fs.rmSync(path.join(root, old), { recursive: true, force: true });
    console.log(dim(`    removido backup antigo: ${old}`));
  }
}

function main() {
  console.log(`\n${bold("Backup do VAT ERP")}\n`);

  if (!composeBase()) {
    fail("Docker nao encontrado.");
    process.exit(1);
  }
  const running = capture(composeBase()[0], [...composeBase()[1], "ps", "-q", "db"], { cwd: DOCKER_DIR });
  if (!running.stdout.trim()) {
    fail("O banco nao esta rodando. Suba o sistema antes de fazer backup.");
    process.exit(1);
  }

  const root = path.resolve(process.argv[2] || path.join(ROOT, "selfhost", "backups"));
  const target = path.join(root, stamp());
  fs.mkdirSync(target, { recursive: true });

  step(`Gravando em ${target}`);
  dumpDatabase(target);
  copyFiles(target);
  prune(root);

  console.log(`
${bold("Backup concluido.")}  ${cyan(target)}

${dim("Lembre: essa pasta tem dados de cliente. O destino precisa estar")}
${dim("criptografado, e uma copia precisa ficar FORA deste computador.")}
`);
}

main();
