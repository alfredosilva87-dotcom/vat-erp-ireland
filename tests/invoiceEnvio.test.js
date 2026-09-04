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

console.log("\n== o nome do ficheiro da fatura ==");
{
  ok(E.nomeDoFicheiro("INV-2026-0001", "Alfredo Junior SA") === "INV-2026-0001 - Alfredo Junior SA.pdf",
     "numero primeiro, cliente depois", E.nomeDoFicheiro("INV-2026-0001", "Alfredo Junior SA"));

  // O numero vem a frente para os ficheiros ordenarem por sequencia na pasta,
  // que e como se procura uma fatura.
  const a = E.nomeDoFicheiro("INV-2026-0002", "Zeta Ltd");
  const b = E.nomeDoFicheiro("INV-2026-0010", "Alfa Ltd");
  ok(a < b, "ordenam por numero e nao por cliente", [a, b]);

  ok(E.nomeDoFicheiro("INV-2026-0001", null) === "INV-2026-0001.pdf",
     "sem cliente, so o numero");
  ok(E.nomeDoFicheiro("INV-2026-0001", "   ") === "INV-2026-0001.pdf",
     "cliente em branco nao deixa um traco solto");
  ok(E.nomeDoFicheiro("INV-2026-0001", "X", true) === "rascunho - X.pdf",
     "rascunho nao usa o numero, que ainda nao e definitivo");
}

console.log("\n== e sobrevive ao sistema de ficheiros e ao cabecalho ==");
{
  // `/` e `:` partem o caminho num sistema ou noutro.
  ok(!/[\/\\:]/.test(E.nomeDoFicheiro("INV-1", "A/B: C\\D")),
     "barras e dois pontos saem", E.nomeDoFicheiro("INV-1", "A/B: C\\D"));

  // As ASPAS partem o proprio Content-Disposition, que e o cabecalho que decide
  // o nome do ficheiro descarregado — sairia truncado, ou com o resto do
  // cabecalho la dentro.
  ok(!E.nomeDoFicheiro("INV-1", 'Ac"me "Ltd').includes('"'),
     "aspas saem, senao partem o Content-Disposition");

  // Acentos: um nome irlandes ou portugues tem-nos, e alguns sistemas de
  // ficheiros normalizam-nos de forma diferente.
  ok(E.nomeDoFicheiro("INV-1", "Niamh Ó Faoláin") === "INV-1 - Niamh O Faolain.pdf",
     "acentos viram a letra base", E.nomeDoFicheiro("INV-1", "Niamh Ó Faoláin"));

  // Um nome muito longo nao pode estourar o limite de caminho.
  const longo = E.nomeDoFicheiro("INV-1", "A".repeat(200));
  ok(longo.length < 90, "nome comprido e cortado", longo.length);

  ok(E.nomeDoFicheiro("INV-1", "  Alfa   Beta  ") === "INV-1 - Alfa Beta.pdf",
     "espacos a mais colapsam");
}

console.log("\n== de quem sai o recibo de vencimento ==");
{
  /*
   * A conta que AUTENTICA no SMTP nao e quem deve aparecer como remetente. Um
   * trabalhador que carrega em responder tem de chegar a quem trata da folha, e
   * nao a uma caixa `noreply@` que ninguem le.
   */
  const vazio = E.enderecosDoRecibo({});
  ok(vazio.de === null && vazio.responderA === null,
    "sem variaveis nao se inventa remetente: o envio fica como sempre foi", vazio);

  const so = E.enderecosDoRecibo({ MAIL_PAYSLIP_FROM: " folha@escritorio.ie " });
  ok(so.de === "folha@escritorio.ie", "o remetente e aparado dos espacos", so);
  ok(so.responderA === "folha@escritorio.ie",
    "sem resposta propria, responde-se a quem enviou — e nao ao SMTP", so);

  // Duas pessoas no escritorio: sai de uma caixa, a resposta vai para as duas.
  const dois = E.enderecosDoRecibo({
    MAIL_PAYSLIP_FROM: "folha@escritorio.ie",
    MAIL_PAYSLIP_REPLY_TO: "alfredo@escritorio.ie, socio@escritorio.ie",
  });
  ok(dois.responderA === "alfredo@escritorio.ie, socio@escritorio.ie",
    "a resposta pode ir para mais do que um endereco", dois);
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
