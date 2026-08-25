// Reseta a senha de um usuario no APP_USERS local (Supabase self-host em
// localhost:8000, via .env.local deste worktree). So mexe no stack local —
// nunca aponta pra produção.
//
// Uso: rode este arquivo no SEU terminal (fora do Claude Code) e digite o
// e-mail e a nova senha quando ele pedir. Ele nunca imprime a senha na tela.
//
//   node scripts/reset-local-password.js

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");

function loadEnvLocal() {
  const p = path.join(__dirname, "..", ".env.local");
  const env = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function ask(question, { hide = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!hide) {
      rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
      return;
    }
    // Esconde o que for digitado, pra senha nao ficar visivel na tela.
    const stdin = process.stdin;
    process.stdout.write(question);
    let input = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (char) => {
      if (char === "\n" || char === "\r" || char === "") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.close();
        resolve(input.trim());
      } else if (char === "") {
        process.exit(1);
      } else if (char === "") {
        input = input.slice(0, -1);
      } else {
        input += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em .env.local");
    process.exit(1);
  }
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error(`Recusado: NEXT_PUBLIC_SUPABASE_URL (${url}) nao parece local. Este script so mexe no stack local.`);
    process.exit(1);
  }

  const email = (await ask("E-mail do usuario: ")).toLowerCase();
  const password = await ask("Nova senha (nao aparece na tela): ", { hide: true });
  if (password.length < 8) {
    console.error("Senha precisa ter pelo menos 8 caracteres.");
    process.exit(1);
  }

  const sb = createClient(url, key);
  const { data: user, error: findErr } = await sb.from("app_users").select("id,email").eq("email", email).maybeSingle();
  if (findErr) { console.error(findErr.message); process.exit(1); }
  if (!user) { console.error(`Nenhum usuario com o e-mail ${email} em app_users (local).`); process.exit(1); }

  const password_hash = await bcrypt.hash(password, 10);
  const { error: updErr } = await sb.from("app_users").update({ password_hash, must_change: false }).eq("id", user.id);
  if (updErr) { console.error(updErr.message); process.exit(1); }

  console.log(`Senha atualizada para ${user.email} no banco local.`);
}

main();
