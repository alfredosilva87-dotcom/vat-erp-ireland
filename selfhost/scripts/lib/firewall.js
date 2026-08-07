"use strict";
/**
 * Opens the server's port on the Windows firewall.
 *
 * Without this the install looks perfect on the server itself and is simply
 * unreachable from every other machine — Windows blocks inbound connections by
 * default, and the symptom (browser hangs, then "can't reach this site") gives
 * no hint about the cause.
 */
const { step, ok, warn, capture } = require("./proc");

const RULE_NAME = "VAT ERP (HTTPS)";

function openWindowsPort(port) {
  if (process.platform !== "win32") return;

  step("Liberando a porta no firewall do Windows");

  // Replacing any previous rule keeps re-runs from stacking duplicates.
  capture("netsh", ["advfirewall", "firewall", "delete", "rule", `name=${RULE_NAME}`]);

  const r = capture("netsh", [
    "advfirewall", "firewall", "add", "rule",
    `name=${RULE_NAME}`,
    "dir=in",
    "action=allow",
    "protocol=TCP",
    `localport=${port}`,
    // Domain + private only: the rule does not follow the machine onto a
    // coffee-shop network.
    "profile=domain,private",
  ]);

  if (r.status === 0) {
    ok(`porta ${port} liberada para a rede local (dominio/privada)`);
  } else {
    warn(`Nao consegui criar a regra de firewall (${r.stderr || r.stdout}).`);
    warn(`Libere a porta ${port} manualmente, ou as outras maquinas nao vao conseguir acessar.`);
  }
}

module.exports = { openWindowsPort, RULE_NAME };
