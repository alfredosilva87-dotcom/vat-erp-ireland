/**
 * A REGRA: O VAT3 CONTA SÓ O QUE FOI CONFERIDO.
 *
 * ---------------------------------------------------------------------------
 * O DEFEITO QUE ISTO FECHA
 *
 * Num teste de ponta a ponta gravaram-se três vendas — € 1.000 (boa), € −500
 * (engano de digitação) e € 0 (a palavra `abc` num campo de dinheiro). Só a
 * primeira foi conferida e contabilizada. A seguir, para o MESMO período:
 *
 *   razão (conta 845) ............. € 230,00   ← conta 1 documento, o conferido
 *   ecrã de IVA / export.csv ...... € 115,00   ← contava os 3, `DOCS 3`
 *
 * O VAT3 exportado levava **metade** do imposto devido, marcado `Open`, pronto
 * a submeter. E as duas telas nunca se confrontavam: quem olhava o balancete
 * via 230, quem carregava em "Export PDF" entregava 115.
 *
 * ---------------------------------------------------------------------------
 * PORQUE A REGRA É ESTA E NÃO A OUTRA
 *
 * Havia duas saídas coerentes — a declaração passar a contar os pendentes, ou
 * o razão passar a contá-los. A segunda é indefensável: um documento por
 * conferir é, por definição, um número que ainda vai mudar, e o razão não pode
 * mudar sozinho. Então é a declaração que se alinha com o razão.
 *
 * O efeito lateral é bom e vale dizê-lo: um documento esquecido na fila de
 * revisão passa a **faltar** na declaração em vez de entrar nela errado. Falta
 * é visível — a verificação `porConferir` do fecho de mês IMPEDE fechar
 * enquanto houver pendentes, e os ecrãs avisam. Errado é invisível.
 *
 * ---------------------------------------------------------------------------
 * PORQUE VIVE AQUI E NÃO EM CADA CONSULTA
 *
 * O mesmo número era calculado em três sítios (o T1 das obrigações, o T2 das
 * obrigações, e o mapa por alíquota que alimenta o ecrã, o Excel e o CSV).
 * Três cópias da regra são três oportunidades de a mudar em dois sítios e
 * esquecer o terceiro — que é exactamente a forma deste defeito ter nascido.
 */

/** Qualquer documento que carregue a marca de conferência. */
export interface Conferivel {
  /** Instante em que alguém disse "conferi". Nulo enquanto ninguém o disse. */
  reviewed_at?: string | null;
}

/**
 * Um documento conta para a declaração?
 *
 * `reviewed_at` ausente **do objecto** (a coluna não foi pedida na consulta) é
 * tratado como conferido de propósito: assim uma consulta que ainda não conhece
 * esta regra não deixa de contar documentos legítimos em silêncio. O erro que
 * se prefere aqui é o visível.
 */
export function contaParaDeclaracao(doc: Conferivel): boolean {
  if (!("reviewed_at" in doc)) return true;
  // String vazia não é uma conferência. `!= null` sozinho deixava-a passar, e
  // uma coluna de texto que chega vazia em vez de nula é coisa que acontece
  // (importação, migração, `''` gravado por engano) — passaria a contar para a
  // declaração um documento que ninguém olhou.
  return typeof doc.reviewed_at === "string" ? doc.reviewed_at.trim() !== "" : doc.reviewed_at != null;
}

/** O que entra na declaração. */
export function apenasConferidos<T extends Conferivel>(docs: T[]): T[] {
  return docs.filter(contaParaDeclaracao);
}

/** O que ficou de fora — para o ecrã poder dizê-lo em vez de o esconder. */
export function pendentes<T extends Conferivel>(docs: T[]): T[] {
  return docs.filter((d) => !contaParaDeclaracao(d));
}

export interface ResumoPendentes {
  /** Quantos documentos do período ainda ninguém conferiu. */
  count: number;
  /** Quanto IVA eles movem, para o aviso poder dizer o tamanho do buraco. */
  vat: number;
}

/**
 * O aviso, em números.
 *
 * Um aviso que diga só "há documentos por conferir" não muda decisão nenhuma.
 * Um que diga "2 documentos, € 115,00 de IVA" diz ao contabilista se pode
 * entregar hoje ou se tem de ir conferir primeiro.
 */
export function resumoPendentes<T extends Conferivel>(docs: T[], vatOf: (d: T) => number): ResumoPendentes {
  const p = pendentes(docs);
  const vat = p.reduce((a, d) => a + (vatOf(d) || 0), 0);
  return { count: p.length, vat: Number(vat.toFixed(2)) };
}
