"use strict";
/**
 * Caddy runs its own certificate authority (`tls internal`). The root of that
 * CA has to be installed on every workstation, otherwise each browser treats
 * the server as untrusted. This pulls it out of the container as a file that
 * can be copied around.
 */
const fs = require("fs");
const path = require("path");

const { ROOT, ok, composeCapture, sleep } = require("./proc");

const CA_IN_CONTAINER = "/data/caddy/pki/authorities/local/root.crt";
const CA_OUT = path.join(ROOT, "selfhost", "server", "root-ca.crt");

/** Retries while Caddy is still starting up and has not generated the CA yet. */
async function exportCa({ tries = 20, intervalMs = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = composeCapture(["exec", "-T", "caddy", "cat", CA_IN_CONTAINER]);
    if (r.status === 0 && r.stdout.includes("BEGIN CERTIFICATE")) {
      fs.writeFileSync(CA_OUT, `${r.stdout}\n`);
      ok("selfhost/server/root-ca.crt");
      return true;
    }
    await sleep(intervalMs);
  }
  return false;
}

module.exports = { exportCa, CA_OUT, CA_IN_CONTAINER };
