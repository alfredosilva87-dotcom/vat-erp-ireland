/**
 * As contas de CONTROLO DE IMPOSTO, num sítio só.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO PRECISA DE EXISTIR SEPARADO
 *
 * Elas são contas de controlo, como as de fornecedores e clientes, mas
 * controlam outra coisa: o saldo de imposto acumulado, e não a soma de faturas
 * em aberto de terceiros.
 *
 * A conciliação de controlo (`lib/financial/control.ts`) monta a lista de
 * contas a partir das que aparecem nos títulos. Quando o imposto apurado
 * passou a gerar título — com a conta de IVA como controlo dele — a conta de
 * IVA inteira entrou nessa comparação, e o saldo acumulado do imposto passou a
 * ser confrontado com um único título. Falso alarme permanente, em todos os
 * clientes, no ecrã de contas a pagar.
 *
 * O comentário daquele ficheiro já avisava contra isto: "um falso alarme que,
 * repetido, ensina a ignorar o aviso". Esta lista é o que o mantém verdadeiro.
 * ---------------------------------------------------------------------------
 *
 * Puro de propósito: é lido pelo servidor e pelo ecrã, e não fala com nada.
 */

/** IVA a pagar, IVA a recuperar, e o imposto sobre o lucro. */
export const CONTAS_DE_IMPOSTO = ["845", "736", "831", "501"] as const;

const CONJUNTO: ReadonlySet<string> = new Set(CONTAS_DE_IMPOSTO);

export function ehContaDeImposto(codigo: string | null | undefined): boolean {
  return Boolean(codigo && CONJUNTO.has(String(codigo).trim()));
}
