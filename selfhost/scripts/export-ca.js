"use strict";
/** Writes selfhost/server/root-ca.crt — the file each workstation must trust. */
const { bold, fail, ok } = require("./lib/proc");
const { exportCa } = require("./lib/ca");

console.log(`\n${bold("Exportando o certificado raiz do servidor")}\n`);

exportCa()
  .then((done) => {
    if (!done) {
      fail("Nao consegui ler o certificado. O container do Caddy esta rodando?");
      process.exit(1);
    }
    ok("Copie esse arquivo para cada computador e instale (veja selfhost/SERVIDOR.md).");
  })
  .catch((err) => {
    fail(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
