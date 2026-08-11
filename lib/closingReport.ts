/**
 * O relatório que prova que o mês fecha (camada A5).
 *
 * A pergunta que ele responde é uma só: **o que o banco diz que aconteceu está
 * todo lançado aqui?** E a resposta tem que ser conferível por alguém que não
 * confia no sistema — um auditor, ou o próprio contador daqui a seis meses.
 *
 * Por isso o relatório separa duas diferenças que costumam ser confundidas:
 *
 *   1. **Extrato × sistema.** Sempre explicada, e por construção: é a soma das
 *      linhas ainda não conciliadas menos os lançamentos ainda sem linha. Se
 *      essa conta não bater, o defeito é do sistema, não do trabalho.
 *
 *   2. **Calculado × informado.** O contador digita o saldo final que está
 *      impresso no extrato de papel. Se der diferente do que o sistema
 *      calculou, é porque alguma linha do banco nunca foi importada — e nenhuma
 *      quantidade de conciliação encontra isso, porque a linha não está lá.
 *
 * Função pura: números entram, relatório sai. É o que permite testar o
 * fechamento sem fechar nada.
 */

export interface ClosingLine {
  id: string;
  line_date: string;
  amount: number;
  description?: string | null;
  status: "unreconciled" | "reconciled" | "ignored";
}

export interface ClosingTxn {
  id: string;
  txn_date: string;
  amount: number;
  description?: string | null;
  statement_line_id?: string | null;
}

export interface ClosingInput {
  openingBalance: number;
  /** Linhas do extrato até a data de fechamento, inclusive. */
  lines: ClosingLine[];
  /** Lançamentos do sistema até a data de fechamento, inclusive. */
  transactions: ClosingTxn[];
  /** Saldo final lido no extrato de papel. */
  reportedBalance?: number | null;
}

export interface ClosingReport {
  openingBalance: number;
  /** Saldo inicial + tudo que o extrato trouxe. */
  statementBalance: number;
  /** Saldo inicial + tudo que foi lançado aqui. */
  systemBalance: number;

  unreconciled: { count: number; total: number; lines: ClosingLine[] };
  outstanding: { count: number; total: number; transactions: ClosingTxn[] };
  ignored: { count: number; total: number };

  /** Extrato − sistema. Tem que ser igual a pendências − lançamentos em aberto. */
  gap: number;
  /** false só se houver defeito no próprio sistema. */
  gapExplained: boolean;

  reportedBalance: number | null;
  /** Informado − calculado. Zero = todas as linhas do banco entraram. */
  difference: number | null;
  /** true quando o mês pode ser dado por fechado. */
  closable: boolean;
  notes: string[];
}

const round = (n: number) => Number(n.toFixed(2));
const sum = (xs: number[]) => round(xs.reduce((a, b) => a + b, 0));

export function buildClosingReport(input: ClosingInput): ClosingReport {
  const opening = round(input.openingBalance || 0);
  const notes: string[] = [];

  // Linha ignorada é decisão do contador ("isto não é meu"), então ela não
  // entra no saldo do extrato — mas aparece no relatório, porque some do
  // trabalho e não pode sumir da prova.
  const active = input.lines.filter((l) => l.status !== "ignored");
  const ignoredLines = input.lines.filter((l) => l.status === "ignored");

  const statementBalance = round(opening + sum(active.map((l) => l.amount)));
  const systemBalance = round(opening + sum(input.transactions.map((t) => t.amount)));

  const unreconciledLines = active.filter((l) => l.status === "unreconciled");
  const outstandingTxns = input.transactions.filter((t) => !t.statement_line_id);

  const unreconciledTotal = sum(unreconciledLines.map((l) => l.amount));
  const outstandingTotal = sum(outstandingTxns.map((t) => t.amount));

  const gap = round(statementBalance - systemBalance);
  // A identidade que sustenta o modelo de duas séries: a diferença entre os
  // dois saldos é exatamente o que ainda não foi casado dos dois lados.
  const gapExplained = Math.abs(round(gap - (unreconciledTotal - outstandingTotal))) <= 0.01;
  if (!gapExplained) {
    notes.push(
      "A diferença entre os dois saldos não é explicada pelas pendências. " +
      "Isso não deveria acontecer — vale conferir os dados antes de fechar."
    );
  }

  const reported = input.reportedBalance == null ? null : round(input.reportedBalance);
  const difference = reported === null ? null : round(reported - statementBalance);

  if (difference !== null && Math.abs(difference) > 0.01) {
    notes.push(
      difference > 0
        ? `O extrato de papel mostra ${Math.abs(difference).toFixed(2)} a MAIS que o importado — provavelmente falta importar linhas.`
        : `O extrato de papel mostra ${Math.abs(difference).toFixed(2)} a MENOS que o importado — pode haver linha importada duas vezes ou de outra conta.`
    );
  }
  if (unreconciledLines.length) {
    notes.push(`${unreconciledLines.length} linha(s) do extrato ainda não foram conciliadas.`);
  }
  if (outstandingTxns.length) {
    notes.push(`${outstandingTxns.length} lançamento(s) do sistema não aparecem no extrato.`);
  }

  return {
    openingBalance: opening,
    statementBalance,
    systemBalance,
    unreconciled: { count: unreconciledLines.length, total: unreconciledTotal, lines: unreconciledLines },
    outstanding: { count: outstandingTxns.length, total: outstandingTotal, transactions: outstandingTxns },
    ignored: { count: ignoredLines.length, total: sum(ignoredLines.map((l) => l.amount)) },
    gap,
    gapExplained,
    reportedBalance: reported,
    difference,
    // Fechar com o saldo informado batendo é o que prova que o extrato inteiro
    // entrou. Pendência de conciliação não impede fechar — ela é legítima
    // (cheque não compensado, pagamento em trânsito) e fica registrada.
    closable: gapExplained && (difference === null || Math.abs(difference) <= 0.01),
    notes,
  };
}

/**
 * Linhas que podem ser a mesma coisa importada duas vezes.
 *
 * O anti-duplicata da camada A1 já recusa o mesmo arquivo; isto pega o que ele
 * não pode pegar — a mesma transação vinda em dois arquivos com descrição
 * levemente diferente, ou lançada à mão além do extrato. Aqui é só um aviso:
 * dois cafés iguais no mesmo dia também são legítimos.
 */
export function findPotentialDuplicates(lines: ClosingLine[]): Array<[ClosingLine, ClosingLine]> {
  const norm = (s: unknown) =>
    String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 20);

  const pairs: Array<[ClosingLine, ClosingLine]> = [];
  const byKey = new Map<string, ClosingLine[]>();
  for (const l of lines) {
    if (l.status === "ignored") continue;
    const key = `${l.line_date}|${round(l.amount)}`;
    const bucket = byKey.get(key) ?? [];
    bucket.push(l);
    byKey.set(key, bucket);
  }

  for (const bucket of byKey.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        // Mesma data e mesmo valor já é suspeito; descrição parecida fecha o
        // caso o suficiente para pedir um olhar.
        const a = norm(bucket[i].description);
        const b = norm(bucket[j].description);
        if (a && b && (a === b || a.startsWith(b.slice(0, 8)) || b.startsWith(a.slice(0, 8)))) {
          pairs.push([bucket[i], bucket[j]]);
        }
      }
    }
  }
  return pairs;
}
