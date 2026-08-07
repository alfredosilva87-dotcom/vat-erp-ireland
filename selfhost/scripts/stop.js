"use strict";
/**
 * Stops the database containers. Data survives — it lives in
 * selfhost/docker/volumes/, not inside the containers.
 */
const { bold, dim, ok, fail, compose, composeBase } = require("./lib/proc");

if (!composeBase()) {
  fail("Docker nao encontrado.");
  process.exit(1);
}

console.log(`\n${bold("Parando o banco de dados...")}\n`);
const r = compose(["stop"]);
if (r.status !== 0) {
  fail("Nao consegui parar os containers.");
  process.exit(1);
}
ok("parado");
console.log(dim("\nOs dados continuam salvos em selfhost/docker/volumes/.\n"));
