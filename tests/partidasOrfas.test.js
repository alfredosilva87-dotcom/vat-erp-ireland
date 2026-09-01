/**
 * Partidas no razao cuja origem ja nao existe — teste da regra.
 *
 * O caso real: conta 812 com razao 4.924,01 e titulos 4.958,21, diferenca
 * -34,20 sem nada no ecra que a explicasse. Eram tres partidas — duas baixas
 * (13,00 e 24,00) e um encargo (2,80) — cujas linhas de origem tinham sido
 * levadas pela CASCATA do banco de dados quando o titulo foi apagado:
 * `ledger_settlements` e `ledger_charges` apontam a `ledger_items` com
 * ON DELETE CASCADE, e `journal` nao aponta a nada disso.
 *
 * -13 -24 +2,80 = -34,20. O numero fecha, e e por isso que a verificacao
 * consegue dizer "isto explica a diferenca inteira" em vez de "ha uma
 * diferenca".
 *
 * A regra e testada sem banco de proposito: o que decide se uma partida e lixo
 * contabil nao pode depender de haver um Postgres de pe.
 */
const { separarOrfas, efeitoNasContas } = require("../.test-build/accounting/partidasOrfasPuro");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const vazio = {
  invoices: new Set(), sales: new Set(), bankTransactions: new Set(),
  charges: new Set(), ledgerItems: new Set(),
};
const vivos = (o) => ({ ...vazio, ...o });

console.log("\n== o caso real: as tres partidas que davam -34,20 ==");
{
  const partidas = [
    { journalId: "j-baixa-13", postingDate: "2026-08-26", sourceModule: "bank",
      documentId: "baixa-apagada-1", documentRef: null,
      contas: [{ code: "812", debit: 13, credit: 0 }, { code: "771", debit: 0, credit: 13 }] },
    { journalId: "j-baixa-24", postingDate: "2026-08-26", sourceModule: "bank",
      documentId: "baixa-apagada-2", documentRef: null,
      contas: [{ code: "812", debit: 24, credit: 0 }, { code: "771", debit: 0, credit: 24 }] },
    { journalId: "j-encargo", postingDate: "2026-08-26", sourceModule: "charge",
      documentId: "encargo-apagado", documentRef: null,
      contas: [{ code: "471", debit: 2.8, credit: 0 }, { code: "812", debit: 0, credit: 2.8 }] },
  ];
  const orfas = separarOrfas(partidas, vazio);
  ok(orfas.length === 3, "as tres sao apanhadas", orfas.length);
  ok(efeitoNasContas(orfas, ["812"]) === -34.2,
     "e o efeito delas na 812 e exactamente -34,20", efeitoNasContas(orfas, ["812"]));

  // O numero tem de fechar com a diferenca da conciliacao, senao a frase
  // "isto explica a diferenca" seria um palpite com ar de facto.
  const diferenca = -34.2;
  ok(Math.abs(efeitoNasContas(orfas, ["812"]) - diferenca) < 0.005,
     "fechando a diferenca da conciliacao por inteiro");

  // A conta do outro lado nao entra na conta da 812.
  ok(efeitoNasContas(orfas, ["771"]) === 37, "e a 771 e lida a parte", efeitoNasContas(orfas, ["771"]));
}

console.log("\n== o que NAO pode ser acusado ==");
{
  const viva = [{ journalId: "j1", postingDate: "2026-01-01", sourceModule: "purchase",
    documentId: "nota-1", documentRef: "F1", contas: [{ code: "812", debit: 0, credit: 100 }] }];
  ok(separarOrfas(viva, vivos({ invoices: new Set(["nota-1"]) })).length === 0,
     "partida de nota que existe");

  const abertura = [{ journalId: "j2", postingDate: "2025-12-31", sourceModule: "opening",
    documentId: null, documentRef: null, contas: [{ code: "812", debit: 0, credit: 6800 }] }];
  ok(separarOrfas(abertura, vazio).length === 0,
     "a abertura, que nasce SEM documento por desenho");

  // `settle()` grava `documentId: bankTransactionId ?? ledgerItemId`. Tratar so
  // um dos dois casos acusaria metade das baixas legitimas — um alarme que
  // grita sempre deixa de ser lido.
  const peloBanco = [{ journalId: "j3", postingDate: "2026-02-04", sourceModule: "bank",
    documentId: "mov-1", documentRef: null, contas: [{ code: "812", debit: 50, credit: 0 }] }];
  ok(separarOrfas(peloBanco, vivos({ bankTransactions: new Set(["mov-1"]) })).length === 0,
     "baixa pelo banco, que aponta ao MOVIMENTO");

  const semBanco = [{ journalId: "j4", postingDate: "2026-02-04", sourceModule: "bank",
    documentId: "titulo-1", documentRef: null, contas: [{ code: "812", debit: 50, credit: 0 }] }];
  ok(separarOrfas(semBanco, vivos({ ledgerItems: new Set(["titulo-1"]) })).length === 0,
     "baixa sem banco, que aponta ao PROPRIO TITULO");

  const folha = [{ journalId: "j5", postingDate: "2026-03-01", sourceModule: "payroll",
    documentId: "titulo-folha", documentRef: null, contas: [{ code: "814", debit: 0, credit: 900 }] }];
  ok(separarOrfas(folha, vivos({ ledgerItems: new Set(["titulo-folha"]) })).length === 0,
     "provisao de folha com o titulo vivo");

  // Um modulo novo nao deve nascer com o razao inteiro marcado como avaria.
  const desconhecido = [{ journalId: "j6", postingDate: "2026-04-01", sourceModule: "modulo-que-ainda-nao-existe",
    documentId: "seja-o-que-for", documentRef: null, contas: [{ code: "812", debit: 1, credit: 0 }] }];
  ok(separarOrfas(desconhecido, vazio).length === 0, "origem desconhecida nao e acusada");
}

console.log("\n== a segunda forma de a baixa desaparecer ==");
{
  // `settle()` grava `documentId: bankTransactionId ?? ledgerItemId`. Baixa
  // feita PELO BANCO aponta ao movimento — e o movimento nao cai com o titulo.
  // A partida fica com um document_id que continua a existir, e a primeira
  // regra passa-lhe ao lado.
  const controlo = new Set(["812", "711"]);
  const baixaOrfa = [{ journalId: "j-baixa", postingDate: "2026-05-01", sourceModule: "bank",
    documentId: "mov-vivo", documentRef: "C09",
    contas: [{ code: "812", debit: 3814.33, credit: 0 }, { code: "771", debit: 0, credit: 3814.33 }] }];

  const semRegra = separarOrfas(baixaOrfa, vivos({ bankTransactions: new Set(["mov-vivo"]) }));
  ok(semRegra.length === 0, "sem a lista de baixas a regra NAO corre — nada de acusacoes inventadas");

  const comRegra = separarOrfas(baixaOrfa, vivos({
    bankTransactions: new Set(["mov-vivo"]),
    settlementJournals: new Set(), contasDeControlo: controlo,
  }));
  ok(comRegra.length === 1, "com a lista, a baixa sem linha e apanhada", comRegra.length);
  ok(/nenhuma baixa a reclama/.test(comRegra[0].falta), "e diz exactamente o que falta", comRegra[0].falta);
  ok(efeitoNasContas(comRegra, ["812"]) === -3814.33, "com o efeito certo na conta de controlo");

  // O que NAO pode ser acusado por esta regra:
  const comBaixa = separarOrfas(baixaOrfa, vivos({
    bankTransactions: new Set(["mov-vivo"]),
    settlementJournals: new Set(["j-baixa"]), contasDeControlo: controlo,
  }));
  ok(comBaixa.length === 0, "baixa cuja linha ainda a reclama");

  // Tarifa, juro, debito directo: movimento de banco que NAO e baixa nunca
  // toca a conta de controlo. Acusa-los seria acusar o razao inteiro do banco.
  const tarifa = [{ journalId: "j-tarifa", postingDate: "2026-05-01", sourceModule: "bank",
    documentId: "mov-vivo-2", documentRef: null,
    contas: [{ code: "651", debit: 12, credit: 0 }, { code: "771", debit: 0, credit: 12 }] }];
  ok(separarOrfas(tarifa, vivos({
    bankTransactions: new Set(["mov-vivo-2"]),
    settlementJournals: new Set(), contasDeControlo: controlo,
  })).length === 0, "tarifa do banco, que nao mexe na conta de controlo");

  // Conta PROPRIA do titulo — o escritorio que separa fornecedores.
  const propria = [{ journalId: "j-propria", postingDate: "2026-05-01", sourceModule: "bank",
    documentId: "mov-vivo-3", documentRef: null,
    contas: [{ code: "8121", debit: 100, credit: 0 }, { code: "771", debit: 0, credit: 100 }] }];
  ok(separarOrfas(propria, vivos({
    bankTransactions: new Set(["mov-vivo-3"]),
    settlementJournals: new Set(), contasDeControlo: new Set(["812", "711", "8121"]),
  })).length === 1, "conta propria do titulo tambem conta como controlo");
}

console.log("\n== o que a orfa diz a quem vai resolver ==");
{
  const orfas = separarOrfas([
    { journalId: "j-b", postingDate: "2026-08-26", sourceModule: "bank",
      documentId: "x", documentRef: "F99", contas: [{ code: "812", debit: 13, credit: 0 }] },
    { journalId: "j-c", postingDate: "2026-08-26", sourceModule: "charge",
      documentId: "y", documentRef: null, contas: [{ code: "812", debit: 0, credit: 2.8 }] },
    { journalId: "j-p", postingDate: "2026-01-06", sourceModule: "purchase",
      documentId: "z", documentRef: "C01", contas: [{ code: "812", debit: 0, credit: 40 }] },
  ], vazio);

  ok(/baixa/.test(orfas[0].falta), "a de banco diz que falta a BAIXA", orfas[0].falta);
  ok(/encargo/.test(orfas[1].falta), "a de encargo diz que falta o ENCARGO", orfas[1].falta);
  ok(/nota de compra/.test(orfas[2].falta), "a de compra diz que falta a NOTA", orfas[2].falta);
  ok(orfas[0].documentRef === "F99" && orfas[0].journalId === "j-b",
     "e leva a referencia e o id do lancamento, para dar para ir la");
}

console.log("\n== ja estornada deixa de ser problema ==");
{
  // Estornar NAO apaga o original — e essa a graca. Mas o efeito dele ja e
  // zero: original mais espelho somam nada. Continuar a acusa-lo fazia a lista
  // nunca esvaziar E a conciliacao dizer que as orfas explicam uma diferenca
  // que ja foi corrigida. Apanhado a testar, com a conta ja fechada.
  const orfa = [{ journalId: "j-orfa", postingDate: "2026-08-25", sourceModule: "charge",
    documentId: "encargo-morto", documentRef: null,
    contas: [{ code: "7100", debit: 5, credit: 0 }, { code: "2100", debit: 0, credit: 5 }] }];

  ok(separarOrfas(orfa, vazio).length === 1, "por estornar, e acusada");
  ok(separarOrfas(orfa, vivos({ estornados: new Set(["j-orfa"]) })).length === 0,
     "estornada, sai da lista");
  ok(efeitoNasContas(separarOrfas(orfa, vivos({ estornados: new Set(["j-orfa"]) })), ["2100"]) === 0,
     "e deixa de contar na diferenca da conciliacao");
}

console.log("\n== somas e sinais ==");
{
  // Conta que a partida nao toca nao entra.
  const so771 = separarOrfas([{ journalId: "j", postingDate: "2026-01-01", sourceModule: "bank",
    documentId: "x", documentRef: null, contas: [{ code: "771", debit: 0, credit: 10 }] }], vazio);
  ok(efeitoNasContas(so771, ["812"]) === 0, "conta nao tocada da zero");

  // Varias contas de controlo somam juntas: um escritorio que separa
  // fornecedores tem 812 e a conta propria do titulo, e a conciliacao le as duas.
  const duas = separarOrfas([{ journalId: "j", postingDate: "2026-01-01", sourceModule: "charge",
    documentId: "x", documentRef: null,
    contas: [{ code: "812", debit: 0, credit: 5 }, { code: "813", debit: 0, credit: 7 }] }], vazio);
  ok(efeitoNasContas(duas, ["812", "813"]) === 12, "duas contas de controlo somam", efeitoNasContas(duas, ["812", "813"]));
  ok(efeitoNasContas([], ["812"]) === 0, "sem orfas o efeito e zero");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
