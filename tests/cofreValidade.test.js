/**
 * A validade dos documentos do cofre — testes.
 *
 * O cofre guarda ficheiros, e isso e a parte que nao erra: ou o ficheiro esta
 * la ou nao esta. O que erra em silencio e a DATA.
 *
 * Um documento de identidade caducado nao da erro nenhum: o cliente continua a
 * aparecer normal em todas as telas, ate ao dia em que o banco ou a Revenue
 * pede o documento e ele ja nao serve. E como a conta e feita em dias, o unico
 * sitio onde se pode enganar por um e aqui — na fronteira.
 */
const C = require("../.test-build/fiscal/cofreTipos.js");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const HOJE = "2026-08-29";

console.log("\n== o documento que nao caduca ==");
{
  const v = C.validadeDe(null, HOJE);
  ok(v.validade === "sem_prazo", "sem data de validade fica 'sem prazo'", v);
  ok(v.dias === null, "e nao inventa uma contagem de dias", v);
}

console.log("\n== as fronteiras, dia a dia ==");
{
  // Caduca HOJE: ainda vale hoje. Chamar-lhe caducado mandaria pedir um
  // documento novo por um dia que ainda e valido.
  const hoje = C.validadeDe(HOJE, HOJE);
  ok(hoje.validade === "a_caducar" && hoje.dias === 0, "caduca hoje: ainda vale, mas a caducar", hoje);

  const ontem = C.validadeDe("2026-08-28", HOJE);
  ok(ontem.validade === "caducado" && ontem.dias === -1, "caducou ontem: caducado, -1 dia", ontem);

  // 60 dias e a fronteira do aviso: dentro avisa, fora nao.
  const em60 = C.validadeDe("2026-10-28", HOJE);
  ok(em60.dias === 60 && em60.validade === "a_caducar", "exatamente 60 dias: ainda avisa", em60);

  const em61 = C.validadeDe("2026-10-29", HOJE);
  ok(em61.dias === 61 && em61.validade === "valido", "61 dias: valido, sem aviso", em61);
}

console.log("\n== a conta nao pode escorregar com o horario de verao ==");
{
  // A Irlanda muda a hora a 25 de outubro de 2026. Uma conta feita em horas
  // locais daria 59.958 dias aqui e arredondaria mal; e por isso que se usa
  // Date.UTC e nao `new Date("...")`.
  const atravessaAMudanca = C.validadeDe("2026-11-15", "2026-10-01");
  ok(atravessaAMudanca.dias === 45, "45 dias por cima da mudanca de hora", atravessaAMudanca);

  const anoBissexto = C.validadeDe("2028-03-01", "2028-02-28");
  ok(anoBissexto.dias === 2, "29 de fevereiro conta como dia", anoBissexto);
}

console.log("\n== o prazo longo ==");
{
  const longe = C.validadeDe("2030-01-01", HOJE);
  ok(longe.validade === "valido" && longe.dias > 1000, "passaporte de 2030: valido e calado", longe);
}

console.log("\n== os tipos que a tela oferece ==");
{
  const caducam = C.TIPOS_DE_DOCUMENTO.filter((t) => t.caduca).map((t) => t.valor);
  ok(caducam.includes("identity") && caducam.includes("address"),
     "identidade e morada pedem validade", caducam);
  // Um pacto social nao expira. Pedir a data convidaria a inventar uma, e uma
  // data inventada dispara um alarme falso daqui a uns anos.
  ok(!caducam.includes("incorporation") && !caducam.includes("tax"),
     "pacto social e registo fiscal NAO pedem validade", caducam);
}

console.log("\n== o que o cofre aceita, e o que recusa ==");
{
  // Um HTML servido pelo cofre seria renderizado na ORIGEM do ERP, com a sessao
  // de quem o abrisse ao alcance do script. Nao ha comprovativo de morada em
  // HTML, entao a lista fecha.
  ok(C.mimeAceite("application/pdf"), "PDF entra");
  ok(C.mimeAceite("image/jpeg") && C.mimeAceite("image/png"), "foto entra");
  ok(C.mimeAceite("image/heic"), "HEIC entra — e o que o iPhone tira");

  ok(!C.mimeAceite("text/html"), "HTML NAO entra");
  ok(!C.mimeAceite("image/svg+xml"), "SVG NAO entra — e imagem, mas leva script dentro");
  ok(!C.mimeAceite("application/xhtml+xml"), "XHTML NAO entra");
  ok(!C.mimeAceite("text/javascript"), "javascript NAO entra");
  ok(!C.mimeAceite(null) && !C.mimeAceite("") && !C.mimeAceite(undefined),
     "sem tipo declarado NAO entra");

  // O navegador manda "image/jpeg; charset=..." as vezes, e ha quem mande
  // maiusculas. Conta o tipo, e nao o que vem colado.
  ok(C.mimeAceite("image/jpeg; charset=binary"), "aceita com parametro colado");
  ok(C.mimeAceite("APPLICATION/PDF"), "aceita em maiusculas");
  // E o contrario tem de continuar a falhar: nao basta CONTER um tipo aceite.
  ok(!C.mimeAceite("text/html; x=application/pdf"),
     "HTML disfarçado com 'application/pdf' no parametro continua recusado");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
