"use strict";
/**
 * Generates the secrets a fresh self-hosted Supabase stack needs.
 *
 * This is a Node port of `docker/utils/generate-keys.sh` (which is /bin/sh and
 * so does not run on Windows). Same algorithms, same byte lengths, same JWT
 * payload shape — the tokens it produces are interchangeable with the ones the
 * official script produces.
 */
const crypto = require("crypto");

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (bytes) => crypto.randomBytes(bytes).toString("hex");
const b64 = (bytes) => crypto.randomBytes(bytes).toString("base64");

function signJwt(payload, secret) {
  const header = '{"alg":"HS256","typ":"JWT"}';
  const signingInput = `${b64url(header)}.${b64url(JSON.stringify(payload))}`;
  const signature = b64url(crypto.createHmac("sha256", secret).update(signingInput).digest());
  return `${signingInput}.${signature}`;
}

/** Every value in .env that must differ from the shipped example. */
function generate() {
  const jwtSecret = b64(30);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 5 * 365 * 24 * 3600; // 5 years, same as the official script

  return {
    JWT_SECRET: jwtSecret,
    ANON_KEY: signJwt({ role: "anon", iss: "supabase", iat, exp }, jwtSecret),
    SERVICE_ROLE_KEY: signJwt({ role: "service_role", iss: "supabase", iat, exp }, jwtSecret),
    SECRET_KEY_BASE: b64(48),
    REALTIME_DB_ENC_KEY: hex(8),
    VAULT_ENC_KEY: hex(16),
    PG_META_CRYPTO_KEY: b64(24),
    LOGFLARE_PUBLIC_ACCESS_TOKEN: b64(24),
    LOGFLARE_PRIVATE_ACCESS_TOKEN: b64(24),
    S3_PROTOCOL_ACCESS_KEY_ID: hex(16),
    S3_PROTOCOL_ACCESS_KEY_SECRET: hex(32),
    MINIO_ROOT_PASSWORD: hex(16),
    POSTGRES_PASSWORD: hex(16),
    DASHBOARD_PASSWORD: hex(16),
    // App session signing key (jose / middleware.ts), not part of the Supabase stack.
    AUTH_SECRET: b64(48),
  };
}

/** Rewrites `KEY=...` lines in an .env body, leaving comments and order intact. */
function applyToEnvFile(body, values) {
  let out = body;
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^${key}=.*$`, "m");
    if (line.test(out)) out = out.replace(line, `${key}=${value}`);
  }
  return out;
}

module.exports = { generate, applyToEnvFile, signJwt };
