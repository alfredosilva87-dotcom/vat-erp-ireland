/**
 * Partidas no razão cuja ORIGEM já não existe.
 *
 * ---------------------------------------------------------------------------
 * O CASO QUE OBRIGOU A ESCREVER ISTO
 *
 * Conta 812: razão 4.924,01, títulos 4.958,21, diferença −34,20. As duas telas
 * estavam certas, cada uma à sua maneira, e não havia como descobrir a causa
 * pelo ecrã — que é exactamente o estado que esta rotina existe para acabar.
 *
 * A causa eram três partidas: duas baixas (13,00 e 24,00) e um encargo (2,80),
 * −13 −24 +2,80 = **−34,20**, cujas linhas de origem em `ledger_settlements` e
 * `ledger_charges` tinham desaparecido. O lançamento ficou.
 *
 * Como é que a linha desaparece e a partida fica:
 *
 *   `ledger_settlements.ledger_item_id` e `ledger_charges.ledger_item_id`
 *   apontam a `ledger_items` com **ON DELETE CASCADE**; `journal` não tem
 *   ligação nenhuma a nada disso.
 *
 * Apagar um título leva as baixas e os encargos dele **dentro do banco de
 * dados**, sem passar pelo código, e as partidas ficam. O caminho de apagar
 * uma baixa à mão faz a coisa certa (apaga a partida primeiro); a cascata não
 * o consulta.
 *
 * O resultado é o pior tipo de erro num sistema contábil: não dá erro, dá um
 * número desactualizado com ar de verdade. O balanço continua a fechar —
 * cada partida órfã continua balanceada por si — e o que deixa de fechar é a
 * conciliação, com uma diferença sem nada que a explique.
 *
 * ---------------------------------------------------------------------------
 * POR QUE A VERIFICAÇÃO DOS ÓRFÃOS QUE JÁ EXISTIA NÃO APANHAVA ISTO
 *
 * Ela olha `source_module in ('purchase','sale')` e pergunta se o documento
 * ainda existe. Estas são `bank` e `charge`, e o que lhes falta não é o
 * documento — é a baixa e o encargo. Ficavam invisíveis nas duas telas ao
 * mesmo tempo.
 */

/** A que tabela o `document_id` de cada origem aponta. */
export type Origem = "purchase" | "sale" | "bank" | "charge" | "payroll" | "manual";

export type PartidaOrfa = {
  journalId: string;
  postingDate: string;
  sourceModule: Origem;
  documentRef: string | null;
  /** O que falta, em português de quem vai resolver. */
  falta: string;
  /** Efeito de cada conta tocada por esta partida, no sinal do saldo dela. */
  contas: { code: string; debit: number; credit: number }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Que ids são LEGÍTIMOS para cada origem.
 *
 * `bank` aceita dois, e não é desleixo: `settle()` grava
 * `documentId: bankTransactionId ?? ledgerItemId` — uma baixa feita pelo banco
 * aponta ao movimento, uma baixa feita sem banco aponta ao próprio título.
 * Tratar só um dos casos acusaria de órfã metade das baixas legítimas, e um
 * alarme que grita sempre deixa de ser lido.
 */
const FALTA: Record<Origem, string> = {
  purchase: "a nota de compra que a originou já não existe",
  sale: "a venda que a originou já não existe",
  bank: "a baixa que a originou já não existe — o título foi apagado e levou-a",
  charge: "o encargo que a originou já não existe — o título foi apagado e levou-o",
  payroll: "o título da folha que a originou já não existe",
  manual: "o título manual que a originou já não existe",
};

/**
 * Separa as partidas vivas das órfãs.
 *
 * Puro de propósito: é a regra que decide se uma partida é lixo contábil, e
 * uma regra dessas tem de ser testável sem banco. O IO fica em
 * `partidasOrfasDoCliente`.
 */
export function separarOrfas(
  partidas: {
    journalId: string; postingDate: string; sourceModule: string;
    documentId: string | null; documentRef: string | null;
    contas: { code: string; debit: number; credit: number }[];
  }[],
  vivos: {
    invoices: Set<string>; sales: Set<string>; bankTransactions: Set<string>;
    charges: Set<string>; ledgerItems: Set<string>;
    /** Os `journal_id` que as linhas de `ledger_settlements` ainda reclamam. */
    settlementJournals?: Set<string>;
    /** 812, 711, e a conta própria de cada título. Ver a segunda regra abaixo. */
    contasDeControlo?: Set<string>;
    /** Lançamentos que já têm um estorno a apontar-lhes. Ver abaixo. */
    estornados?: Set<string>;
  }
): PartidaOrfa[] {
  const orfas: PartidaOrfa[] = [];
  for (const p of partidas) {
    // Sem `document_id` não há origem que possa faltar. É o caso da abertura,
    // que nasce sem documento por desenho — acusá-la seria acusar o desenho.
    if (!p.documentId) continue;
    /*
     * JÁ ESTORNADA deixa de ser problema.
     *
     * Estornar não apaga o original — é essa a graça —, e por isso ele continua
     * a não ter origem. Mas o efeito dele no razão já é zero: original mais
     * espelho somam nada. Continuar a acusá-lo tinha duas consequências, ambas
     * más: a lista nunca esvaziava, e `efeitoNasContas` contava um desvio que
     * a conta de controlo já não tem — a conciliação passaria a dizer que as
     * órfãs explicam uma diferença que foi corrigida.
     *
     * Apanhado a testar: estornei uma, a conta fechou, e a tela continuou a
     * acusar a mesma partida.
     */
    if (vivos.estornados?.has(p.journalId)) continue;
    const m = p.sourceModule as Origem;
    const existe =
      m === "purchase" ? vivos.invoices.has(p.documentId)
        : m === "sale" ? vivos.sales.has(p.documentId)
          // Ver o comentário de FALTA: a baixa aponta ao movimento OU ao título.
          : m === "bank" ? vivos.bankTransactions.has(p.documentId) || vivos.ledgerItems.has(p.documentId)
            : m === "charge" ? vivos.charges.has(p.documentId)
              : m === "payroll" || m === "manual" ? vivos.ledgerItems.has(p.documentId)
                // Origem que não se conhece não se acusa: um módulo novo não
                // deve nascer com o razão inteiro marcado como avaria.
                : true;
    /*
     * A SEGUNDA forma de a baixa desaparecer, e a primeira não a apanhava.
     *
     * `settle()` grava `documentId: bankTransactionId ?? ledgerItemId`. Quando
     * a baixa foi feita pelo banco, o `document_id` aponta ao MOVIMENTO — e o
     * movimento não cai com o título. Apagar o título leva a linha de
     * `ledger_settlements` pela cascata e deixa para trás uma partida cujo
     * `document_id` continua a existir: o razão debita a conta de controlo, o
     * título já não tem baixa nenhuma, e a regra de cima passa-lhe ao lado.
     *
     * O que distingue é a CONTA. Uma baixa toca a conta de controlo; um
     * movimento de banco que não é baixa — tarifa, juro, débito directo — toca
     * despesa e banco, nunca 812 nem 711. Logo: partida de banco que mexe na
     * conta de controlo TEM de ter uma baixa a reclamá-la.
     *
     * Sem `settlementJournals` a regra não corre — chamador que não a passa
     * fica com o comportamento antigo em vez de com acusações inventadas.
     */
    if (existe) {
      const podeVerificar = m === "bank" && vivos.settlementJournals && vivos.contasDeControlo;
      const mexeNoControlo = podeVerificar
        && p.contas.some((c) => vivos.contasDeControlo!.has(c.code));
      if (!(mexeNoControlo && !vivos.settlementJournals!.has(p.journalId))) continue;
      orfas.push({
        journalId: p.journalId, postingDate: p.postingDate, sourceModule: m,
        documentRef: p.documentRef,
        falta: "mexe na conta de controlo mas nenhuma baixa a reclama — o título foi apagado e levou a baixa",
        contas: p.contas,
      });
      continue;
    }
    orfas.push({
      journalId: p.journalId, postingDate: p.postingDate, sourceModule: m,
      documentRef: p.documentRef, falta: FALTA[m] ?? "a origem já não existe",
      contas: p.contas,
    });
  }
  return orfas;
}

/**
 * Quanto estas partidas empurram CADA UMA das contas dadas.
 *
 * O sinal segue o saldo de uma conta de passivo (crédito − débito), que é o
 * lado em que vivem 812 e 711 — as duas contas de controlo que esta rotina
 * existe para explicar. É esse número que, somado à diferença, a fecha: se a
 * conciliação acusa −34,20 e as órfãs valem −34,20, está explicada inteira.
 */
export function efeitoNasContas(orfas: PartidaOrfa[], contas: string[]): number {
  const alvo = new Set(contas);
  let efeito = 0;
  for (const o of orfas) {
    for (const c of o.contas) {
      if (alvo.has(c.code)) efeito += (Number(c.credit) || 0) - (Number(c.debit) || 0);
    }
  }
  return r2(efeito);
}

