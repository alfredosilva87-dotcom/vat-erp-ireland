"use strict";
/**
 * Port picking. 3000 and 8000 are popular enough that a shared office PC often
 * already has something on them, and a half-installed stack that silently
 * failed to bind is much harder to diagnose than a different port number.
 */
const net = require("net");
const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "..", "..", "config.json");

function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "0.0.0.0");
  });
}

/** First free port at or after `start`, stepping by `step`. */
async function pickPort(start, { step = 10, tries = 20 } = {}) {
  for (let i = 0; i < tries; i++) {
    const port = start + i * step;
    if (await isFree(port)) return port;
  }
  throw new Error(`Nenhuma porta livre a partir de ${start}.`);
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
}

module.exports = { isFree, pickPort, readConfig, writeConfig, CONFIG_FILE };
