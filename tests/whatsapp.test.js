/**
 * O numero do WhatsApp — teste.
 *
 * Um so defeito justifica este ficheiro inteiro: o **prefixo nacional**.
 *
 * Os telefones vieram do Excel escritos a maneira de ca — `353 087 063 2331`.
 * Tirar o que nao e digito da `3530870632331`, que nao existe. O link abre, o
 * WhatsApp diz que o contacto e invalido, e quem esta a usar conclui que o
 * sistema esta partido — por causa de um zero.
 *
 * Nao da erro em lado nenhum, e por isso e que tem de estar aqui.
 */
const { waNumber, waLink, waMostrar } = require("../.test-build/whatsapp");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

console.log("\n== o zero que nao entra ==");
{
  ok(waNumber("353 087 063 2331") === "353870632331",
     "o 0 do 087 sai — e o prefixo nacional, nao entra no internacional",
     waNumber("353 087 063 2331"));
  ok(waNumber("353 83 835 7648") === "353838357648",
     "sem o zero, fica como esta");
  ok(waNumber("00353871234567") === "353871234567",
     "o 00 a frente e a forma antiga do +, e sai");
  ok(waNumber("+353 (0)87 123 4567") === "353871234567",
     "parenteses, mais e espacos saem todos");
}

console.log("\n== formato NACIONAL, sem indicativo nenhum ==");
{
  /*
   * O defeito que ele apanhou no ar: no cadastro deste escritorio os telefones
   * estao como toda a gente os escreve — `0838380361`, sem indicativo. Sem ele
   * o link saia `wa.me/0838380361` e o WhatsApp respondia "This link couldn't
   * be opened". O `0` da frente e prefixo de marcacao interna e sai; o
   * indicativo do pais entra no lugar dele.
   */
  ok(waNumber("0838380361") === "353838380361",
     "movel irlandes nacional ganha o 353 e perde o 0", waNumber("0838380361"));
  ok(waNumber("0838421731") === "353838421731", "e o segundo do cadastro tambem");
  ok(waNumber("016761234") === "35316761234", "fixo de Dublin idem");
  ok(waNumber("083 838 0361") === "353838380361", "com espacos da o mesmo");

  // `00` continua a ser o + a moda antiga, e nao um numero nacional.
  ok(waNumber("00353838380361") === "353838380361",
     "e o 00 nao se confunde com o prefixo nacional");

  // Quem ja tem indicativo nao ganha outro por cima.
  ok(waNumber("353838380361") === "353838380361", "com indicativo, fica como esta");
  ok(!waNumber("353838380361").startsWith("353353"), "e nunca leva 353 a dobrar");
}

console.log("\n== lixo no cadastro nao vira link ==");
{
  /*
   * Um botao que abre uma pagina de erro ensina a desconfiar de todos os
   * outros. Numero curto de mais nao e telefone: e um campo mal preenchido.
   */
  ok(waNumber("0") === "", "um zero sozinho nao e telefone");
  ok(waNumber("1234") === "", "quatro digitos tambem nao");
  ok(waLink("123") === null, "e por isso nao sai link nenhum");
  ok(waNumber("0838380361").length >= 7, "e um numero a serio passa");
}

console.log("\n== outros paises da lista ==");
{
  ok(waNumber("351 091 234 5678") === "35191234 5678".replace(/\D/g, ""),
     "Portugal tambem perde o zero", waNumber("351 091 234 5678"));
  ok(waNumber("55 011 98765 4321") === "5511987654321", "Brasil perde o zero do DDD");
  ok(waNumber("44 07700 900123") === "447700900123", "Reino Unido perde o zero");
}

console.log("\n== o que NAO se adivinha ==");
{
  /*
   * Um pais fora da lista entra como esta. Adivinhar mal produz um numero que
   * nao existe, e isso e pior do que deixar como veio: um numero errado abre
   * uma conversa com outra pessoa.
   */
  ok(waNumber("81 090 1234 5678") === "810901234567" + "8",
     "pais fora da lista entra tal e qual", waNumber("81 090 1234 5678"));

  // O trunco aplica-se UMA vez, ao indicativo que casa primeiro.
  ok(waNumber("3530871234567").startsWith("35387"), "so um zero e retirado");
}

console.log("\n== sem numero ==");
{
  ok(waNumber("") === "", "vazio da vazio");
  ok(waNumber(null) === "", "nulo da vazio");
  ok(waNumber("—") === "", "um traco no cadastro nao e um telefone");
  ok(waNumber("n/a") === "", "texto sem digitos nenhum tambem nao");
}

console.log("\n== o link ==");
{
  ok(waLink("353 83 835 7648") === "https://wa.me/353838357648",
     "sem mensagem, so a conversa");
  ok(waLink("353 83 835 7648", "Ola!") === "https://wa.me/353838357648?text=Ola!",
     "com mensagem, ela vai codificada", waLink("353 83 835 7648", "Ola!"));
  ok(waLink("353 83 835 7648", "horas ate quinta?").includes("%20"),
     "os espacos sao codificados, senao o link parte");

  /*
   * Sem numero devolve `null` e nao um link a meio. Um botao que abre uma
   * pagina de erro e pior do que um botao visivelmente desligado: o primeiro
   * ensina a desconfiar de todos os outros.
   */
  ok(waLink("") === null, "sem numero nao ha link");
  ok(waLink(null, "Ola") === null, "nem com mensagem");

  // Espacos a mais na mensagem nao produzem um `?text=` vazio.
  ok(waLink("353838357648", "   ") === "https://wa.me/353838357648",
     "mensagem so com espacos nao vai");
}

console.log("\n== como se mostra ==");
{
  ok(waMostrar("353 087 063 2331") === "+353870632331", "mostra o numero ja corrigido");
  ok(waMostrar(null) === "—", "e sem numero mostra um traco");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
