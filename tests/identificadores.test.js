/**
 * O QUE O CADASTRO ACEITAVA SEM UMA QUEIXA — teste.
 *
 * As entradas do primeiro bloco são as que passaram no teste de ponta a ponta:
 * `XXXX` num VAT number, `sem-arroba-nenhum` num e-mail, `abcdefgh` num
 * telefone, `XXXX-not-a-pps` num PPS. Todas gravaram sem aviso.
 *
 * Duas coisas que este teste guarda com igual cuidado:
 *
 * 1. O aviso NÃO é uma recusa. Campo vazio tem de passar, e um número
 *    estrangeiro tem de poder ser gravado. Se alguém transformar isto num
 *    bloqueio, o escritório escreve IE0000000A para o ecrã calar — e um número
 *    inventado é pior do que um campo vazio, porque mente.
 * 2. O dígito de controlo é conta, não tabela: mexer numa tecla tem de mudar o
 *    resultado. É isso que apanha o erro de digitação no dia em que acontece.
 */
const {
  avisoVatIrlandes, avisoPps, avisoEmail, avisoTelefone,
  normalizarTelefone, caractereDeControlo,
} = require("../.test-build/fiscal/identificadores");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
const mau = (r) => r.ok === false;
const bom = (r) => r.ok === true;

console.log("\n== O QUE GRAVOU SEM QUEIXA NO TESTE DE PONTA A PONTA ==");
ok(mau(avisoVatIrlandes("XXXX")), "VAT 'XXXX' passa a avisar", avisoVatIrlandes("XXXX"));
ok(mau(avisoEmail("sem-arroba-nenhum")), "e-mail sem @ passa a avisar", avisoEmail("sem-arroba-nenhum"));
ok(mau(avisoTelefone("abcdefgh")), "telefone com letras passa a avisar", avisoTelefone("abcdefgh"));
ok(mau(avisoPps("XXXX-not-a-pps")), "PPS de lixo passa a avisar", avisoPps("XXXX-not-a-pps"));

console.log("\n== o aviso NAO e uma recusa: o vazio passa sempre ==");
ok(bom(avisoVatIrlandes("")) && bom(avisoVatIrlandes(null)) && bom(avisoVatIrlandes(undefined)), "VAT vazio passa");
ok(bom(avisoPps("")) && bom(avisoEmail("")) && bom(avisoTelefone("")), "PPS, e-mail e telefone vazios passam");

console.log("\n== o digito de controlo e conta, e a conta fecha sobre si ==");
{
  // Constroi-se um numero valido com a propria conta e confere-se que valida.
  const d = "1234567";
  const c = caractereDeControlo(d);
  ok(bom(avisoVatIrlandes(`IE${d}${c}`)), `IE${d}${c} (controlo calculado) e aceite`, avisoVatIrlandes(`IE${d}${c}`));
  ok(bom(avisoPps(`${d}${c}`)), `${d}${c} e aceite como PPS`);

  // E que MEXER numa tecla o derruba — que e o erro que se quer apanhar.
  const errado = CHECK_WRONG(c);
  ok(mau(avisoVatIrlandes(`IE${d}${errado}`)), "trocar a letra de controlo e apanhado");
  ok(mau(avisoVatIrlandes(`IE1234568${c}`)), "trocar um DIGITO e apanhado", avisoVatIrlandes(`IE1234568${c}`));
  ok(mau(avisoVatIrlandes(`IE2134567${c}`)), "trocar dois digitos de posicao e apanhado");
}
function CHECK_WRONG(c) { return c === "A" ? "B" : "A"; }

console.log("\n== o formato de nove caracteres (a segunda letra conta) ==");
{
  const d = "1234567";
  const c1 = caractereDeControlo(d);
  const c2 = caractereDeControlo(d, "A");
  ok(c1 !== c2, "a segunda letra MUDA o controlo — senao nao estaria a entrar na conta", { c1, c2 });
  ok(bom(avisoVatIrlandes(`IE${d}${c2}A`)), `IE${d}${c2}A e aceite`, avisoVatIrlandes(`IE${d}${c2}A`));
  ok(mau(avisoVatIrlandes(`IE${d}${c1}A`)), "e o controlo do formato de 8 nao serve no de 9");
}

console.log("\n== formato antes de conta: o que nem tem forma de VAT ==");
ok(mau(avisoVatIrlandes("12345")), "curto demais");
ok(mau(avisoVatIrlandes("IE12345678901")), "comprido demais");
ok(mau(avisoVatIrlandes("ABCDEFGH")), "so letras");
ok(avisoVatIrlandes("12345").chave === "id.vatFormat", "e diz QUAL o problema: formato", avisoVatIrlandes("12345"));
ok(avisoVatIrlandes("IE1234567A").chave === "id.vatCheckDigit" || bom(avisoVatIrlandes("IE1234567A")), "digito de controlo tem chave propria — formato e digito pedem correccoes diferentes");

console.log("\n== o prefixo IE e os separadores nao atrapalham ==");
{
  const d = "1234567", c = caractereDeControlo(d);
  ok(bom(avisoVatIrlandes(`${d}${c}`)), "sem prefixo IE");
  ok(bom(avisoVatIrlandes(`ie${d}${c}`.toLowerCase())), "minusculas");
  ok(bom(avisoVatIrlandes(`IE ${d}-${c}`)), "com espaco e travessao");
}

console.log("\n== e-mail: apanhar o obvio, nao a especificacao ==");
ok(bom(avisoEmail("alfredo@example.ie")), "e-mail normal");
ok(bom(avisoEmail("a.b+tag@sub.dominio.co.uk")), "e-mail com ponto, mais e subdominio");
ok(mau(avisoEmail("sem@dominio")), "sem ponto no dominio");
ok(mau(avisoEmail("dois@@arrobas.ie")), "dois arrobas");
ok(mau(avisoEmail("com espaco@dominio.ie")), "espaco no meio");

console.log("\n== telefone: o link de WhatsApp tem de abrir em alguem ==");
ok(bom(avisoTelefone("083 838 0361")), "numero irlandes com espacos");
ok(bom(avisoTelefone("+353 83 838 0361")), "com indicativo");
ok(mau(avisoTelefone("083 ABC 0361")), "letras no meio");
ok(mau(avisoTelefone("12")), "curto demais");
ok(mau(avisoTelefone("1234567890123456789")), "comprido demais");

console.log("\n== E.164, que e o que o wa.me/ quer ==");
ok(normalizarTelefone("083 838 0361") === "+353838380361", "nacional ganha indicativo e perde o zero", normalizarTelefone("083 838 0361"));
ok(normalizarTelefone("+353 83 838 0361") === "+353838380361", "ja internacional fica igual", normalizarTelefone("+353 83 838 0361"));
ok(normalizarTelefone("00353838380361") === "+353838380361", "o 00 vira +", normalizarTelefone("00353838380361"));
ok(normalizarTelefone("+44 20 7946 0958") === "+442079460958", "numero de outro pais NAO e reescrito para a Irlanda", normalizarTelefone("+44 20 7946 0958"));
ok(normalizarTelefone("") === "" && normalizarTelefone(null) === "", "vazio fica vazio");

console.log(`\n${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
