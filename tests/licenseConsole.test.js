/**
 * O console assina no NAVEGADOR; a instalacao do cliente confere no servidor.
 *
 * Sao duas implementacoes diferentes da mesma coisa — WebCrypto de um lado,
 * node:crypto do outro — e elas tem de produzir exatamente os mesmos bytes.
 * O erro que estes testes existem para pegar e mudar a ordem dos campos da
 * carga canonica (ou o base64url) num lado so: tudo continua a compilar, o
 * console continua a emitir, e a chave simplesmente NAO ATIVA no cliente.
 * O sintoma aparece a semanas de distancia, na maquina de outra pessoa.
 *
 * O Node 18+ tem o mesmo WebCrypto do navegador, entao o caminho do console
 * roda aqui tal e qual.
 */
const { generateKeyPairSync, webcrypto } = require("crypto");
if (!global.crypto) global.crypto = webcrypto;

const consola = require("../.test-build/console/licenseConsole.js");
const servidor = require("../.test-build/console/licenseKey.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

(async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env.LICENSE_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();

  console.log("\n== o navegador assina, o servidor confere ==");
  const chave = await consola.importarChave(privPem);
  const carga = consola.montarCarga({ slug: "cliente-teste", name: "Cliente Teste Ltd", months: 9 });
  const doNavegador = await consola.emitir(carga, chave);

  const v = servidor.verifyLicenseKey(doNavegador);
  ok(v.ok, "a assinatura feita no navegador confere no servidor", v.ok ? undefined : v.error);
  ok(v.ok && v.payload.c === "cliente-teste", "e a carga chega inteira", v.ok && v.payload);

  console.log("\n== os dois emissores produzem os MESMOS bytes ==");
  ok(servidor.issueLicenseKey(carga, privPem) === doNavegador,
     "mesma carga, mesma chave: saida identica");

  console.log("\n== o que nao pode passar ==");
  ok(!servidor.verifyLicenseKey(doNavegador.slice(0, -4) + "AAAA").ok,
     "assinatura adulterada e recusada");
  ok(!servidor.verifyLicenseKey(doNavegador.replace("VATERP1", "OUTRO")).ok,
     "prefixo trocado e recusado");
  {
    // Carga alterada depois de assinada: o caso que a assinatura existe para
    // apanhar — alguem estica a validade da propria licenca.
    const partes = doNavegador.split(".");
    const cargaCrua = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    cargaCrua.e = "2099-12-31";
    const esticada = partes[0] + "." +
      Buffer.from(JSON.stringify(cargaCrua), "utf8").toString("base64url") + "." + partes[2];
    ok(!servidor.verifyLicenseKey(esticada).ok, "validade esticada a mao e recusada");
  }

  console.log("\n== o cofre da chave no navegador ==");
  const guardado = {};
  global.localStorage = {
    getItem: (k) => (k in guardado ? guardado[k] : null),
    setItem: (k, v) => { guardado[k] = v; },
    removeItem: (k) => { delete guardado[k]; },
  };
  await consola.guardarChave(privPem, "senha-de-teste-123");
  ok(consola.temChaveGuardada(), "fica guardada");
  ok(!JSON.stringify(guardado).includes("PRIVATE KEY"),
     "e o PEM NAO aparece em texto puro no armazenamento");
  ok((await consola.abrirChave("senha-de-teste-123")).trim() === privPem.trim(),
     "a senha certa devolve o PEM");
  try {
    await consola.abrirChave("senha-errada");
    ok(false, "a senha errada tem de falhar");
  } catch (e) {
    ok(e.message === "Senha errada.", "a senha errada falha com mensagem util", e.message);
  }
  consola.esquecerChave();
  ok(!consola.temChaveGuardada(), "e da para esquecer a chave neste aparelho");

  console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
