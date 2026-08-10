/**
 * Proposing which document a statement line pays (camada A2).
 *
 * This is the part that decides whether reconciliation feels like work or like
 * confirming. It is deliberately a **pure function**: lines and candidate
 * documents in, a ranked list out. No database, so every rule below is testable
 * without a fixture, and a wrong proposal can be reproduced from the two inputs
 * alone.
 *
 * The ranking follows the same idea as lib/duplicates.ts — trust signals in
 * order of how hard they are to produce by accident:
 *
 *   1. the document's own number, written in the statement description
 *   2. the amount matching what is still owed, to the cent
 *   3. the supplier's or customer's name in the description
 *   4. how close the dates are
 *
 * A proposal is never applied on its own. The accountant confirms — that is the
 * difference between a system that helps and a system that has to be audited.
 */

export type CandidateKind = "invoice" | "sale";

export interface MatchLine {
  line_date: string;
  /** Positivo entra, negativo sai. */
  amount: number;
  description: string | null;
  reference: string | null;
  payee?: string | null;
}

export interface MatchCandidate {
  kind: CandidateKind;
  id: string;
  /** Fornecedor (compra) ou cliente (venda). */
  party: string | null;
  doc_number: string | null;
  doc_date: string | null;
  /** Total do documento. */
  total: number;
  /** Quanto ainda falta liquidar. Igual ao total enquanto nada foi pago. */
  outstanding: number;
}

export interface MatchSuggestion {
  candidate: MatchCandidate;
  score: number;
  reasons: string[];
  /** O valor da linha bate ao cêntimo com o que falta liquidar. */
  exactAmount: boolean;
}

/**
 * A partir daqui a sugestão é boa o bastante para aparecer já preenchida.
 *
 * 45 é onde ficam **dois sinais independentes concordando** — nome do
 * fornecedor mais valor exato (15 + 30). Um sozinho não chega: valor exato sem
 * nome dá 30, nome sem valor dá 15.
 *
 * O limiar já foi 55, e estava errado: com 55, o mesmo par nota/linha era
 * proposto se a data estivesse a 3 dias e deixava de ser a 4, porque só então o
 * bônus de data caía de 10 para 6. Evidência idêntica com resultado diferente
 * por causa de dois dias é ruído, não confiança — e a maioria dos extratos não
 * traz o número do documento na descrição, então o efeito prático era não
 * propor quase nada.
 */
export const CONFIDENT_SCORE = 45;

const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Só letras e dígitos: "INV 2026-014" e "inv2026/014" viram a mesma coisa. */
const squash = (s: unknown) => norm(s).replace(/[^a-z0-9]/g, "");

const daysBetween = (a: string, b: string) => {
  const t1 = Date.parse(`${a}T00:00:00Z`);
  const t2 = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return null;
  return Math.round(Math.abs(t1 - t2) / 86400000);
};

/**
 * Palavras do nome que valem como sinal. "Ltd", "the" e afins aparecem em meio
 * mundo de fornecedor e casariam com qualquer coisa.
 */
const NOISE = new Set([
  "ltd", "limited", "plc", "the", "and", "de", "da", "do", "of", "inc", "llc",
  "company", "co", "services", "service", "group", "holdings", "ireland", "irl",
]);

function partyTokens(party: string | null): string[] {
  return norm(party)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !NOISE.has(w));
}

/**
 * Ranks candidates for one statement line, best first.
 *
 * Everything with a positive score is returned — the screen shows the leader as
 * the proposal and the rest behind "outras correspondências possíveis", which
 * is what makes a wrong guess cheap to correct.
 */
export function suggestMatches(
  line: MatchLine,
  candidates: MatchCandidate[]
): MatchSuggestion[] {
  const haystack = squash(`${line.description ?? ""} ${line.reference ?? ""} ${line.payee ?? ""}`);
  const words = norm(`${line.description ?? ""} ${line.reference ?? ""} ${line.payee ?? ""}`);
  const magnitude = Math.abs(line.amount);
  // Saída de dinheiro liquida compra; entrada liquida venda. O contrário
  // existe (estorno), mas é raro o bastante para ser penalizado e não sumir.
  const expected: CandidateKind = line.amount < 0 ? "invoice" : "sale";

  const out: MatchSuggestion[] = [];

  for (const c of candidates) {
    let score = 0;
    const reasons: string[] = [];

    const docKey = squash(c.doc_number);
    // Número curto ("14") casaria com qualquer descrição por acidente.
    if (docKey.length >= 4 && haystack.includes(docKey)) {
      score += 50;
      reasons.push(`Número ${c.doc_number} aparece na descrição`);
    }

    const owed = Math.abs(c.outstanding);
    const exactAmount = Math.abs(owed - magnitude) <= 0.01;
    if (exactAmount) {
      score += 30;
      reasons.push("Valor bate exatamente com o saldo em aberto");
    } else if (Math.abs(Math.abs(c.total) - magnitude) <= 0.01) {
      score += 25;
      reasons.push("Valor bate com o total do documento");
    } else if (owed > 0 && Math.abs(owed - magnitude) / owed <= 0.01) {
      score += 10;
      reasons.push("Valor quase bate (menos de 1% de diferença)");
    } else if (magnitude > owed + 0.01) {
      // Pagamento maior que a dívida: possível, mas é sinal de que não é este
      // documento sozinho.
      score -= 5;
    }

    const tokens = partyTokens(c.party);
    if (tokens.length && tokens.some((t) => words.includes(t))) {
      score += 15;
      reasons.push(`${c.party} aparece na descrição`);
    }

    const gap = c.doc_date ? daysBetween(line.line_date, c.doc_date) : null;
    if (gap !== null) {
      if (gap <= 3) { score += 10; reasons.push("Data muito próxima"); }
      else if (gap <= 10) { score += 6; }
      else if (gap <= 30) { score += 3; }
      else if (gap > 60) { score -= 5; }
    }

    if (c.kind !== expected) {
      score -= 40;
      reasons.push(
        expected === "invoice"
          ? "Atenção: é uma venda, e esta linha é saída de dinheiro"
          : "Atenção: é uma compra, e esta linha é entrada de dinheiro"
      );
    }

    if (score > 0) out.push({ candidate: c, score, reasons, exactAmount });
  }

  // Empate resolvido pela data mais próxima — é o que o contador faria, e é o
  // que o Xero faz.
  return out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ga = a.candidate.doc_date ? daysBetween(line.line_date, a.candidate.doc_date) ?? 9999 : 9999;
    const gb = b.candidate.doc_date ? daysBetween(line.line_date, b.candidate.doc_date) ?? 9999 : 9999;
    if (ga !== gb) return ga - gb;
    return Math.abs(a.candidate.outstanding) - Math.abs(b.candidate.outstanding);
  });
}

/**
 * The one to show already filled in, if any.
 *
 * Two candidates that score the same are *not* a proposal: picking one at
 * random and having it confirmed with a click is how a wrong link gets made
 * without anyone deciding anything. When it is a tie, both go to the list and
 * the accountant chooses.
 */
export function bestSuggestion(suggestions: MatchSuggestion[]): MatchSuggestion | null {
  const top = suggestions[0];
  if (!top || top.score < CONFIDENT_SCORE) return null;
  const second = suggestions[1];
  if (second && second.score === top.score) return null;
  return top;
}
