/**
 * O telefone para o WhatsApp — testes.
 *
 * Um numero mal convertido nao da erro: da uma conversa aberta com OUTRA
 * pessoa, e a fatura de um cliente — com nome, morada e numero de VAT — vai
 * para o telefone de um desconhecido. E o unico sitio deste modulo onde um erro
 * silencioso tem consequencia para terceiros.
 */
const E = require("../.test-build/invoicing/envioPuro.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

console.log("\n== os formatos que as pessoas escrevem ==");
{
  ok(E.telefoneParaWhatsapp("+353 87 123 4567") === "353871234567", "internacional com espacos");
  ok(E.telefoneParaWhatsapp("+353-87-123-4567") === "353871234567", "com tracos");
  ok(E.telefoneParaWhatsapp("00353871234567") === "353871234567", "com 00 a frente");
  // O formato nacional irlandes: o zero cai e entra o indicativo.
  ok(E.telefoneParaWhatsapp("087 123 4567") === "353871234567", "nacional irlandes 087...");
  ok(E.telefoneParaWhatsapp("(087) 123 4567") === "353871234567", "com parenteses");
}

console.log("\n== o que NAO se adivinha ==");
{
  // Sem indicativo e sem zero nao ha como saber o pais. Tratar como irlandes
  // por engano manda a fatura para o telefone de outra pessoa.
  ok(E.telefoneParaWhatsapp("871234") === null, "numero curto demais nao vira telefone");
  ok(E.telefoneParaWhatsapp("") === null && E.telefoneParaWhatsapp(null) === null,
     "vazio e nulo dao nulo");
  ok(E.telefoneParaWhatsapp("sem telefone") === null, "texto sem digitos da nulo");

  // Um numero longo o suficiente ja traz o indicativo dentro.
  ok(E.telefoneParaWhatsapp("351912345678") === "351912345678", "portugues completo passa inteiro");
}

console.log("\n== o indicativo nao e sempre o irlandes ==");
{
  ok(E.telefoneParaWhatsapp("087 123 4567", "44") === "44871234567",
     "com outro indicativo padrao, o zero cai para esse");
}

console.log("\n== o link ==");
{
  const l = E.linkDeWhatsapp("+353871234567", "Invoice INV-2026-0001");
  ok(l.startsWith("https://wa.me/353871234567?text="), "leva o numero e o texto", l);
  ok(l.includes("INV-2026-0001"), "o numero da fatura vai na mensagem");
  ok(!l.includes(" "), "o texto vai codificado, sem espacos crus", l);

  // Sem telefone abre o WhatsApp com o texto pronto e a pessoa escolhe a
  // conversa. E melhor do que nao abrir nada.
  const sem = E.linkDeWhatsapp(null, "Ola");
  ok(sem === "https://wa.me/?text=Ola", "sem numero, abre para escolher a conversa", sem);
}

console.log("\n== o SMTP diz O QUE falta, e nao so que falta ==");
{
  const guardado = { ...process.env };
  for (const k of ["MAIL_SMTP_HOST", "MAIL_SMTP_USER", "MAIL_SMTP_PASSWORD", "MAIL_SMTP_PORT", "MAIL_SMTP_SECURE", "MAIL_SMTP_FROM"]) delete process.env[k];

  const nada = E.configSmtp();
  ok(nada.ok === false && nada.faltam.length === 3, "sem nada, acusa as tres variaveis", nada);

  process.env.MAIL_SMTP_HOST = "smtp.exemplo.ie";
  const meio = E.configSmtp();
  ok(meio.ok === false && meio.faltam.length === 2 && !meio.faltam.includes("MAIL_SMTP_HOST"),
     "com o host posto, so acusa as duas que faltam", meio);

  process.env.MAIL_SMTP_USER = "faturas@exemplo.ie";
  process.env.MAIL_SMTP_PASSWORD = "x";
  const cheio = E.configSmtp();
  ok(cheio.ok === true, "com as tres, configura");
  // 587 e STARTTLS, 465 e TLS implicito. Adivinhar pelo porto evita a variavel
  // a mais que toda a gente esquece.
  ok(cheio.cfg.port === 587 && cheio.cfg.secure === false, "587 por omissao, sem TLS implicito", cheio.cfg);

  process.env.MAIL_SMTP_PORT = "465";
  ok(E.configSmtp().cfg.secure === true, "no 465 o TLS liga-se sozinho");

  // Sem remetente proprio, usa o utilizador — que e o que quase sempre esta certo.
  ok(E.configSmtp().cfg.from === "faturas@exemplo.ie", "o remetente cai no utilizador");
  process.env.MAIL_SMTP_FROM = "nao-responder@exemplo.ie";
  ok(E.configSmtp().cfg.from === "nao-responder@exemplo.ie", "e o remetente proprio ganha");

  Object.assign(process.env, guardado);
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
