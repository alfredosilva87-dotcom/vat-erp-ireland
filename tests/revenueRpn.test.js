/**
 * O CLIENTE DO RPN — teste.
 *
 * O exemplo do primeiro bloco é a resposta PUBLICADA pela Revenue
 * (`Example_1 Full_PAYE_Modernisation_Life_Cycle / 1.2_LookupRPNResponse.json`),
 * copiada tal e qual. Se a leitura dos campos mudar, isto parte — e é assim que
 * se descobre a tempo, em vez de na semana do primeiro pagamento.
 *
 * O resto do teste é sobre o que acontece quando corre MAL, porque é aí que o
 * utilizador fica sozinho: um `401` da Revenue pode ser o certificado, a
 * assinatura ou o relógio, e os três pedem gestos diferentes.
 */
const crypto = require("crypto");
const {
  lerRpn, aCentimos, traduzirFalha, buscarRpns, HOSTS, CAMINHO_BASE, SOFTWARE,
} = require("../.test-build/revenue/rpn");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

// A resposta oficial, verbatim.
const OFICIAL = {
  employerName: "Employer1",
  employerRegistrationNumber: "3980609P",
  taxYear: 2019,
  totalRPNCount: 1,
  rpns: [{
    rpnNumber: "5",
    employeeID: { employeePpsn: "00000008P", employmentID: "1" },
    rpnIssueDate: "2019-01-10",
    effectiveDate: "2019-01-01",
    endDate: "2019-12-31",
    incomeTaxCalculationBasis: "CUMULATIVE",
    yearlyTaxCredits: 3300.00,
    taxRates: [
      { index: 1, taxRatePercent: 20, yearlyRateCutOff: 33800.00 },
      { index: 2, taxRatePercent: 40 },
    ],
    payForIncomeTaxToDate: 1230.00,
    incomeTaxDeductedToDate: 0,
    uscStatus: "ORDINARY",
    uscRates: [
      { index: 1, uscRatePercent: 0.5, yearlyUSCRateCutOff: 12012.00 },
      { index: 2, uscRatePercent: 2.5, yearlyUSCRateCutOff: 18772.00 },
      { index: 3, uscRatePercent: 5, yearlyUSCRateCutOff: 70044.00 },
      { index: 4, uscRatePercent: 8 },
    ],
    payForUSCToDate: 1230.00,
    uscDeductedToDate: 12.28,
    lptToDeduct: 191.00,
  }],
};

console.log("\n== A RESPOSTA OFICIAL DA REVENUE, lida campo a campo ==");
{
  const r = lerRpn(OFICIAL.rpns[0]);
  ok(r.ppsn === "00000008P", "o PPS");
  ok(r.employmentId === "1", "e o employmentID — o que separa os DOIS empregos da mesma pessoa");
  ok(r.base === "CUMULATIVE", "a base vem de QUEM MANDA, nao de uma caixa do cadastro", r.base);
  ok(r.creditosAnuais === 330000, "3.300,00 EUR viram 330000 centimos", r.creditosAnuais);
  ok(r.cutOffAnual === 3380000, "o cut-off e o do PRIMEIRO escalao: 33.800,00", r.cutOffAnual);
  ok(r.pagoParaImpostoAteAgora === 123000, "o acumulado de quem entra a meio do ano", r.pagoParaImpostoAteAgora);
  ok(r.impostoDescontadoAteAgora === 0, "zero e zero, e nao 'em falta'", r.impostoDescontadoAteAgora);
  ok(r.uscDescontadoAteAgora === 1228, "12,28 EUR viram 1228 — o centimo nao se perde", r.uscDescontadoAteAgora);
  ok(r.lptADescontar === 19100, "e o LPT retido na fonte, que era uma lacuna do PSR", r.lptADescontar);
  ok(r.uscStatus === "ORDINARY", "o estado de USC");
  ok(Array.isArray(r.uscRates) && r.uscRates.length === 4, "os quatro escaloes de USC ficam guardados");
  ok(r.bruto === OFICIAL.rpns[0], "e a resposta INTEIRA fica, para responder 'porque mudou o desconto?'");
}

console.log("\n== o segundo escalao NAO tem cut-off, e isso nao e um campo em falta ==");
{
  // 40% nao tem tecto. Ir buscar o cut-off ao escalao errado daria um numero
  // plausivel e errado — o pior tipo.
  const r = lerRpn({ ...OFICIAL.rpns[0], taxRates: [{ index: 2, taxRatePercent: 40 }] });
  ok(r.cutOffAnual === null, "sem escalao 1, nao se inventa cut-off", r.cutOffAnual);
}

console.log("\n== centimos: onde os arredondamentos costumam nascer ==");
{
  ok(aCentimos(0) === 0, "zero e zero");
  ok(aCentimos(null) === null && aCentimos(undefined) === null && aCentimos("") === null,
    "ausente e ausente — e nao zero, que seria um numero inventado");
  ok(aCentimos(12.28) === 1228, "12,28");
  ok(aCentimos(0.1 + 0.2) === 30, "0,30 apesar da virgula flutuante", aCentimos(0.1 + 0.2));
  ok(aCentimos(1234.565) === 123457 || aCentimos(1234.565) === 123456, "arredonda, nao trunca", aCentimos(1234.565));
}

console.log("\n== os erros da Revenue traduzidos para o gesto seguinte ==");
{
  ok(traduzirFalha(401).codigo === "assinaturaRecusada", "401 e assinatura/certificado");
  ok(traduzirFalha(403).codigo === "semAutorizacao", "403 e autorizacao — o TAIN ou o empregador");
  ok(traduzirFalha(400).codigo === "pedidoInvalido", "400 e o pedido");
  ok(traduzirFalha(404).codigo === "naoEncontrado", "404 e o recurso");
  ok(traduzirFalha(503).codigo === "indisponivel", "5xx e do lado deles");
  ok(traduzirFalha(418).codigo === "respostaEstranha", "e o que nao se conhece tem nome proprio");
  ok(traduzirFalha(401).chave.startsWith("rev.err"), "todos levam chave de traducao, nao frase");
}

console.log("\n== O RELOGIO E VERIFICADO ANTES DE GASTAR UM PEDIDO ==");
{
  // Um servidor mal sincronizado responderia 401 — o MESMO codigo de uma
  // assinatura errada — e mandava toda a gente procurar o certificado.
  const original = Date.now;
  Date.now = () => original();
  const assinar = () => "x";
  // Forca-se a data para fora da janela mexendo no relogio do processo.
  const realDate = Date;
  global.Date = class extends realDate {
    constructor(...a) { super(...(a.length ? a : [0])); }
    static now() { return 0; }
    toISOString() { return "2000-01-01T00:00:00.000Z"; }
  };
  buscarRpns({ ambiente: "test", certificadoBase64: "c", assinar }, "1234567T", 2026, {})
    .then((r) => {
      global.Date = realDate;
      ok(r.ok === false && r.falha.codigo === "relogio",
        "fora da janela de 90 min: diz que e o RELOGIO, e nao gasta o pedido", r.falha);
      segunda();
    });
  function segunda() { correrRestante(); }
}

function correrRestante() {
  console.log("\n== o pedido que sai: endpoint, query e ambiente ==");
  let visto = null;
  const assinar = (s) => crypto.createHash("sha256").update(s).digest("base64");
  const fetchFalso = async (url, init) => {
    visto = { url, init };
    return { ok: true, status: 200, text: async () => JSON.stringify(OFICIAL) };
  };

  buscarRpns(
    { ambiente: "test", certificadoBase64: "CERT", assinar, agentTain: "11221W" },
    "3980609P", 2019,
    { employeeIds: ["3980609P-1"], fetchImpl: fetchFalso }
  ).then((r) => {
    ok(r.ok === true, "resposta boa e resposta boa");
    ok(r.rpns.length === 1 && r.rpns[0].ppsn === "00000008P", "e traz o RPN lido");
    ok(r.total === 1, "e o total que ELES dizem, para se conferir contra o que chegou");

    ok(visto.url.startsWith(`https://${HOSTS.test}${CAMINHO_BASE}/rpn/3980609P/2019?`),
      "o endpoint do guia, no ambiente de TESTE", visto.url.slice(0, 80));
    ok(visto.url.includes(`softwareUsed=${SOFTWARE.usado}`), "identifica o software");
    ok(visto.url.includes("agentTain=11221W"), "e leva o TAIN do escritorio, que age como agente");
    ok(visto.url.includes("employeeIDs=3980609P-1"),
      "e restringe ao emprego pedido — e assim que se ensaia com UM funcionario");
    ok(visto.init.headers.Signature.includes('algorithm="rsa-sha512"'), "vai assinado");
    ok(visto.init.headers.Digest === undefined, "GET nao leva Digest");

    ok(HOSTS.production === "www.ros.ie" && HOSTS.test !== HOSTS.production,
      "e os dois ambientes sao mesmo diferentes — trocar um pelo outro submete a serio por engano");

    terceira();
  });
}

function terceira() {
  console.log("\n== quando a Revenue recusa, e quando a rede cai ==");
  const assinar = () => "x";
  const cred = { ambiente: "test", certificadoBase64: "c", assinar };

  const recusa = async () => ({ ok: false, status: 401, text: async () => "Unauthorised" });
  buscarRpns(cred, "1234567T", 2026, { fetchImpl: recusa }).then((r) => {
    ok(r.ok === false && r.falha.codigo === "assinaturaRecusada", "401 chega traduzido", r.falha.codigo);

    const cai = async () => { throw new Error("ENOTFOUND"); };
    buscarRpns(cred, "1234567T", 2026, { fetchImpl: cai }).then((r2) => {
      ok(r2.ok === false && r2.falha.codigo === "rede", "a rede a cair NAO se confunde com uma recusa deles", r2.falha.codigo);

      const lixo = async () => ({ ok: true, status: 200, text: async () => "<html>manutencao</html>" });
      buscarRpns(cred, "1234567T", 2026, { fetchImpl: lixo }).then((r3) => {
        ok(r3.ok === false && r3.falha.codigo === "respostaEstranha",
          "e um 200 com HTML lá dentro nao passa por RPN vazio", r3.falha.codigo);
        fim();
      });
    });
  });
}

function fim() {
  console.log(`\n${pass} ok, ${fail} falha(s)`);
  process.exit(fail ? 1 : 0);
}
