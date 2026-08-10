/**
 * Um pagamento que não cobre exatamente uma nota (camada A4).
 *
 * É onde a conciliação real acontece: o fornecedor manda três faturas e recebe
 * um pagamento só; o cliente paga metade agora e metade no mês que vem; o banco
 * come uma tarifa no meio do caminho; e sobra um cêntimo de arredondamento que
 * não é erro de ninguém.
 *
 * Duas regras mandam em tudo aqui:
 *
 *   1. **A soma das partes é o valor da linha.** Sempre. Uma conciliação que
 *      não fecha não prova nada, e provar é o motivo de a conciliação existir.
 *
 *   2. **Diferença não some em silêncio.** Um cêntimo vira lançamento numa
 *      conta de arredondamento, visível; uma sobra grande vira aviso, não um
 *      ajuste automático. Diferença escondida é como um mês fecha errado sem
 *      ninguém notar.
 *
 * Função pura: valores entram, plano sai. Sem banco.
 */

export interface SettlementPick {
  /** Identificador do documento (id da nota ou da venda). */
  key: string;
  /** Quanto ainda falta liquidar nele, sempre positivo. */
  outstanding: number;
  /** Valor que o contador digitou. Vazio = o sistema propõe. */
  amount?: number | null;
}

export interface SettlementPart {
  key: string;
  /** Magnitude aplicada a este documento (sem sinal). */
  amount: number;
  /** true quando sobra saldo devedor neste documento depois deste pagamento. */
  partial: boolean;
  /** Quanto continua em aberto no documento. */
  remaining: number;
}

export interface SettlementPlan {
  parts: SettlementPart[];
  /** Soma aplicada aos documentos. */
  assigned: number;
  /** Valor da linha menos o que foi aplicado, com sinal. */
  leftover: number;
  /** Sobra pequena o bastante para ser arredondamento. */
  rounding: number | null;
  /** Sobra grande: quase sempre tarifa bancária ou documento faltando. */
  unexplained: number | null;
  warnings: string[];
  /** true quando documentos + ajuste fecham com a linha. */
  balanced: boolean;
}

/**
 * Até aqui a diferença é arredondamento; acima disso é outra coisa.
 *
 * Cinco cêntimos porque conversão de moeda e desconto de fornecedor produzem
 * esse tipo de resto. Uma tarifa de banco nunca é tão pequena, e um documento
 * faltando muito menos — então nada disso passa por "arredondamento".
 */
export const ROUNDING_TOLERANCE = 0.05;

const round = (n: number) => Number(n.toFixed(2));

/**
 * Divides one statement line over the documents it settles.
 *
 * Picks sem valor digitado recebem o que ainda cabe, na ordem. É o que faz o
 * caso comum — "esta linha paga estas três notas" — não precisar de digitação
 * nenhuma.
 */
export function planSettlement(
  lineAmount: number,
  picks: SettlementPick[],
  opts: { tolerance?: number } = {}
): SettlementPlan {
  const tolerance = opts.tolerance ?? ROUNDING_TOLERANCE;
  const total = Math.abs(round(lineAmount));
  const sign = lineAmount < 0 ? -1 : 1;
  const warnings: string[] = [];

  // Primeiro os valores digitados: eles mandam, e o automático divide o que
  // sobrar. O contrário faria o sistema discordar de quem está decidindo.
  const typed = picks.map((p) => (p.amount == null || p.amount === "" as any ? null : Math.abs(round(Number(p.amount)))));
  const typedSum = typed.reduce<number>((s, v) => s + (v ?? 0), 0);
  let remaining = round(total - typedSum);

  const parts: SettlementPart[] = picks.map((p, i) => {
    const outstanding = Math.abs(round(p.outstanding));
    let amount: number;

    if (typed[i] !== null) {
      amount = typed[i] as number;
    } else if (remaining <= 0) {
      amount = 0;
    } else {
      // Nunca oferecer mais do que o documento deve: pagar €500 numa nota de
      // €100 e deixar o sistema "resolver" é como um crédito fantasma nasce.
      amount = Math.min(outstanding, remaining);
      remaining = round(remaining - amount);
    }

    amount = round(amount);
    if (amount > outstanding + 0.001) {
      warnings.push(`O valor aplicado (${amount.toFixed(2)}) é maior que o saldo em aberto do documento (${outstanding.toFixed(2)}).`);
    }
    return {
      key: p.key,
      amount,
      partial: amount + 0.001 < outstanding,
      remaining: round(Math.max(0, outstanding - amount)),
    };
  });

  const assigned = round(parts.reduce((s, p) => s + p.amount, 0));
  const leftoverMagnitude = round(total - assigned);
  const leftover = round(leftoverMagnitude * sign);

  let rounding: number | null = null;
  let unexplained: number | null = null;

  if (Math.abs(leftoverMagnitude) > 0.001) {
    if (Math.abs(leftoverMagnitude) <= tolerance) {
      rounding = leftover;
    } else {
      unexplained = leftover;
      warnings.push(
        leftoverMagnitude > 0
          ? `Faltam ${Math.abs(leftover).toFixed(2)} para fechar a linha — tarifa bancária, ou algum documento não foi marcado.`
          : `Os documentos somam ${Math.abs(leftover).toFixed(2)} a mais que a linha.`
      );
    }
  }

  const partial = parts.filter((p) => p.partial && p.amount > 0);
  if (partial.length) {
    warnings.push(
      `Pagamento parcial: ${partial.length} documento(s) continuam em aberto (${partial
        .map((p) => p.remaining.toFixed(2))
        .join(", ")}).`
    );
  }

  return {
    parts,
    assigned,
    leftover,
    rounding,
    unexplained,
    warnings,
    // Fecha quando não sobra nada, ou quando o que sobrou é arredondamento e
    // vai virar lançamento próprio.
    balanced: Math.abs(leftoverMagnitude) <= 0.001 || rounding !== null,
  };
}

export interface SettlementAllocation {
  invoiceId?: string | null;
  saleId?: string | null;
  accountCode?: string | null;
  amount: number;
  description?: string | null;
}

/**
 * Turns a plan into the movements to be written, signed like the line.
 *
 * O arredondamento vira um lançamento seu, com conta própria. Some-lo no valor
 * de uma das notas faria a nota parecer paga por um valor que ninguém emitiu.
 */
export function planToAllocations(
  lineAmount: number,
  plan: SettlementPlan,
  documents: Array<{ key: string; invoiceId?: string | null; saleId?: string | null }>,
  roundingAccount?: string | null
): SettlementAllocation[] {
  const sign = lineAmount < 0 ? -1 : 1;
  const out: SettlementAllocation[] = [];

  for (const part of plan.parts) {
    if (part.amount <= 0) continue;
    const doc = documents.find((d) => d.key === part.key);
    out.push({
      invoiceId: doc?.invoiceId ?? null,
      saleId: doc?.saleId ?? null,
      amount: round(part.amount * sign),
    });
  }

  if (plan.rounding !== null && Math.abs(plan.rounding) > 0.001) {
    out.push({
      accountCode: roundingAccount ?? null,
      amount: round(plan.rounding),
      description: "Diferença de arredondamento",
    });
  }

  return out;
}
