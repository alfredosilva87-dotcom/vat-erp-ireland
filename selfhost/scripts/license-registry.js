/**
 * Registro local das licenças emitidas. RODA NA MÁQUINA DE QUEM VENDE.
 *
 * Antes disso o license-issue.js imprimia a chave e esquecia: se o e-mail ao
 * cliente se perdesse, não havia de onde copiar de novo nem como saber o que
 * foi emitido para quem. Este arquivo é essa memória — um JSONL simples, uma
 * emissão por linha, que o dono da chave privada pode versionar num backup.
 *
 * Fica junto da chave privada e com a mesma permissão restrita: o texto da
 * chave é a própria licença, quem tem o texto ativa a instalação.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const DIR = path.join(os.homedir(), ".vat-erp-license");
const PRIV = path.join(DIR, "private.pem");
const LEDGER = path.join(DIR, "issued.jsonl");

/**
 * lib/licenseKey.ts é TypeScript; compila a quente para não exigir build só
 * para emitir ou listar uma licença.
 */
function loadLicenseLib() {
  const out = path.join(os.tmpdir(), "vat-license-build");
  execFileSync("npx", ["tsc", "lib/licenseKey.ts", "--outDir", out, "--module", "commonjs",
    "--target", "es2020", "--esModuleInterop", "--skipLibCheck"],
    { cwd: path.join(__dirname, "..", ".."), stdio: "inherit" });
  return require(path.join(out, "licenseKey.js"));
}

function append(entry) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  // Uma linha por emissão: acrescentar nunca reescreve o que já está gravado,
  // então uma falha no meio não leva o histórico junto.
  fs.appendFileSync(LEDGER, JSON.stringify(entry) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(LEDGER, 0o600);
  } catch {
    /* sistema de arquivos sem permissão POSIX; o conteúdo já foi gravado */
  }
}

/**
 * Linhas ilegíveis não derrubam a leitura: devolve o que deu para entender e
 * conta o resto, para uma edição manual malfeita aparecer em vez de sumir.
 */
function read() {
  if (!fs.existsSync(LEDGER)) return { entries: [], unreadable: 0 };
  const entries = [];
  let unreadable = 0;
  for (const line of fs.readFileSync(LEDGER, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      unreadable++;
    }
  }
  return { entries, unreadable };
}

module.exports = { DIR, PRIV, LEDGER, loadLicenseLib, append, read };
