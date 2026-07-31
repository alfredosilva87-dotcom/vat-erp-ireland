import type { RawExtraction } from "@/lib/types";

// Computes a REAL confidence score from the extracted content itself (sums
// reconcile, VAT rates are plausible, dates make sense) instead of a fixed
// per-engine number. Used by lib/extractor/index.ts to decide when a
// text-only PDF read needs to be escalated to vision, and to flag a result
// for human review when even vision doesn't clear the bar.

export interface ScoreResult {
  score: number;
  issues: string[];
}

// Below this, a pdf-native (text) read is escalated to Gemini vision.
export const ESCALATION_THRESHOLD = 0.85;
// Below this, the final (post-escalation) result is flagged needs_review.
export const REVIEW_THRESHOLD = 0.85;

// Official Irish VAT rates (Revenue). A rate outside this set on a line
// item is a strong signal the document was misread.
const VALID_VAT_RATES = [0, 4.8, 9, 13.5, 23];
const RATE_EPSILON = 0.05; // float/parsing slack, not a real tolerance

const isValidRate = (rate: number) => VALID_VAT_RATES.some((r) => Math.abs(r - rate) <= RATE_EPSILON);

const isValidIsoDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
};

const eur = (n: number) => n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function scoreExtraction(data: RawExtraction): ScoreResult {
  const issues: string[] = [];
  let earned = 0;
  let applicable = 0;
  // Only the checks that actually cross-verify numbers against each other
  // count toward the coverage guard below — "has items" / "has a supplier
  // name" are presence checks, not verification.
  let substantiveChecksApplied = 0;

  // 1. Has at least one line item (weight 3, always applicable).
  applicable += 3;
  if (data.items.length > 0) {
    earned += 3;
  } else {
    issues.push("No line items were found on this document.");
  }

  // 2. Sum of line items vs. document total (weight 4) — the check that
  // catches columns scrambled by pdf-parse, so it carries the most weight.
  // `net_amount` is documented as the line's NET value, so it should
  // reconcile with total_net first. Fall back to total_gross only when
  // total_net is absent — e.g. simple receipts (Tesco/Lidl/Dunnes) where
  // VAT isn't broken out per line and net_amount ends up holding the
  // gross line price instead (see EXTRACTION_INSTRUCTION in prompt.ts).
  const withAmount = data.items.filter((it) => it.net_amount != null);
  const total = data.total_net ?? data.total_gross;
  if (data.items.length > 0 && total != null && withAmount.length / data.items.length >= 0.5) {
    applicable += 4;
    substantiveChecksApplied++;
    const sum = withAmount.reduce((a, it) => a + (it.net_amount || 0), 0);
    const tol = Math.max(1, 0.025 * Math.abs(total));
    if (Math.abs(sum - total) <= tol) {
      earned += 4;
    } else {
      issues.push(`Item totals (€${eur(sum)}) don't match the document total (€${eur(total)}).`);
    }
  }

  // 3. total_net + total_vat ≈ total_gross (weight 3) — a pure arithmetic
  // identity, kept tight since a failure here is a strong signal.
  if (data.total_net != null && data.total_vat != null && data.total_gross != null) {
    applicable += 3;
    substantiveChecksApplied++;
    const tol = Math.max(0.05, 0.005 * Math.abs(data.total_gross));
    if (Math.abs(data.total_net + data.total_vat - data.total_gross) <= tol) {
      earned += 3;
    } else {
      issues.push(
        `Net + VAT (€${eur(data.total_net + data.total_vat)}) doesn't match the gross total (€${eur(data.total_gross)}).`
      );
    }
  }

  // 4. Per-line VAT rates within the valid Irish set (weight 2).
  const ratedItems = data.items.filter((it) => it.vat_rate_on_invoice != null);
  if (ratedItems.length > 0) {
    applicable += 2;
    substantiveChecksApplied++;
    const bad = ratedItems.find((it) => !isValidRate(it.vat_rate_on_invoice as number));
    if (!bad) {
      earned += 2;
    } else {
      issues.push(`Unexpected VAT rate on a line item: ${bad.vat_rate_on_invoice}%.`);
    }
  }

  // 5. Invoice date is valid and not in the future (weight 2, +1 day grace
  // for timezone edge cases).
  if (data.invoice_date) {
    applicable += 2;
    substantiveChecksApplied++;
    const valid = isValidIsoDate(data.invoice_date);
    const notFuture = valid && new Date(`${data.invoice_date}T00:00:00Z`).getTime() <= Date.now() + 24 * 3600 * 1000;
    if (valid && notFuture) {
      earned += 2;
    } else {
      issues.push(`Invoice date "${data.invoice_date}" looks invalid or is in the future.`);
    }
  }

  // 6. Supplier name present (weight 1, soft signal, always applicable).
  applicable += 1;
  if (data.supplier_name) {
    earned += 1;
  } else {
    issues.push("Supplier name wasn't identified.");
  }

  let score = applicable > 0 ? earned / applicable : 0;

  // Coverage guard: a read with items and a supplier name but nothing to
  // cross-verify (no totals, no per-line rates, no date) isn't a verified
  // read — cap it so it doesn't pass as fully confident by default.
  if (substantiveChecksApplied === 0) {
    score = Math.min(score, 0.5);
    issues.push("Not enough data on the document to verify this read (no totals, rates or date to cross-check).");
  }

  return { score: Number(score.toFixed(3)), issues };
}
