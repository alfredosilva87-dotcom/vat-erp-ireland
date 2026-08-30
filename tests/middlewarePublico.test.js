/**
 * O que o middleware deixa passar SEM sessao — testes.
 *
 * Le o ficheiro como TEXTO, e nao importa o modulo: o middleware do Next puxa
 * `next/server` e `jose`, e monta-lo num teste custaria mais do que aquilo que
 * se quer verificar. O que interessa aqui e uma propriedade estrutural, e essa
 * le-se no ficheiro.
 *
 * O risco que este teste guarda: a passagem por telefone (`RELAY_ONLY`) roda o
 * MESMO codigo do ERP e so deve servir a captura de documentos. Cada rota nova
 * que alguem meta na lista errada alarga a superficie daquela implantacao —
 * silenciosamente, porque ninguem abre a passagem para conferir o que ela serve.
 */
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "..", "middleware.ts"), "utf8");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

/** O corpo de uma funcao nomeada, para olhar so para dentro dela. */
function corpoDe(nome) {
  const i = src.indexOf(`function ${nome}(`);
  if (i < 0) return null;
  const fim = src.indexOf("\n}", i);
  return src.slice(i, fim);
}

console.log("\n== a fatura partilhada abre sem sessao ==");
{
  const bloco = src.slice(src.indexOf("pathname === \"/login\""), src.indexOf("const token = req.cookies"));
  ok(/ehFaturaPartilhada\(pathname\)/.test(bloco),
     "a liberacao de sessao chama ehFaturaPartilhada");
  ok(corpoDe("ehFaturaPartilhada")?.includes("/api/invoice-share/"),
     "e ela reconhece /api/invoice-share/");
}

console.log("\n== mas NAO entra no que a passagem serve ==");
{
  const captura = corpoDe("isPublicCapturePath");
  ok(captura !== null, "isPublicCapturePath existe");
  // Esta e a asserçao que importa. `RELAY_ONLY` responde 404 a tudo o que nao
  // esta nesta lista: por-la aqui faria a implantacao da passagem — que aponta
  // para outro banco — passar a servir faturas.
  ok(!captura.includes("invoice-share"),
     "a fatura NAO esta na lista da passagem (RELAY_ONLY)", captura);
  ok(!captura.includes("/api/clients"), "nem nenhuma rota de cliente");
  ok(!captura.includes("/api/invoices"), "nem as faturas por outro caminho");
}

console.log("\n== a passagem continua a servir o que precisa ==");
{
  const captura = corpoDe("isPublicCapturePath");
  for (const caminho of ["/enviar/", "/api/phone/upload", "/api/phone/keepalive", "/api/phone/manifest/"]) {
    ok(captura.includes(caminho), `a passagem serve ${caminho}`);
  }
}

console.log("\n== a trava do RELAY_ONLY continua a ser 404 e nao redireccao ==");
{
  // Na passagem nao existe login para onde redireccionar, e um 302 para uma
  // pagina que nao existe daria um ciclo.
  const i = src.indexOf("process.env.RELAY_ONLY");
  const bloco = src.slice(i, i + 220);
  ok(/status:\s*404/.test(bloco), "responde 404", bloco.slice(0, 160));
  ok(/!isPublicCapturePath\(pathname\)/.test(bloco), "e usa a mesma lista da captura");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
