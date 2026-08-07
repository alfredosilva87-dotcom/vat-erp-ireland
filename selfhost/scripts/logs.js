"use strict";
/** Tails the container logs — the first thing to look at when something fails. */
const { bold, fail, compose, composeBase } = require("./lib/proc");

if (!composeBase()) {
  fail("Docker nao encontrado.");
  process.exit(1);
}

const service = process.argv[2];
console.log(`\n${bold("Logs do Docker")} (Ctrl+C para sair)\n`);
compose(["logs", "-f", "--tail", "200", ...(service ? [service] : [])]);
