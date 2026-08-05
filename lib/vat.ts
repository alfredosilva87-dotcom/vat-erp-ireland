// Single source of truth for turning a line amount into VAT.
//
// The bug this fixes: forecourt and supermarket receipts (Circle K, Centra,
// Dunnes…) print the VAT-INCLUSIVE shelf price per line, not the net amount.
// Treating that as net and multiplying by the rate over-claims by the rate
// itself — on a 23% receipt the claim comes out ~27% too high.
//
//   line is net   ->  VAT = amount * rate / 100
//   line is gross ->  VAT = amount * rate / (100 + rate)
//
// Which basis applies is decided by comparing the sum of the lines against the
// document's own totals, so we never have to guess per supplier.

export type Basis = "net" | "gross" | "unknown";

export interface VatLine {
  net_amount: number | null;
  /** Per-line VAT when the document prints it — always wins when present. */
  vat_amount_on_invoice?: number | null;
  vat_rate_on_invoice?: number | null;
  expected_vat_rate?: number | null;
}

export interface DocTotals {
  total_net?: number | null;
  total_vat?: number | null;
  total_gross?: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The rate to use for a line: what the document printed, else the base rate. */
export const rateOf = (l: VatLine): number | null =>
  l.vat_rate_on_invoice ?? l.expected_vat_rate ?? null;

/**
 * Decides whether the line amounts are net or VAT-inclusive by seeing which
 * document total they add up to. Returns "unknown" when neither matches (or
 * there is nothing to compare against), and the caller should stay conservative.
 */
export function detectBasis(lines: VatLine[], totals: DocTotals): Basis {
  const withAmount = lines.filter((l) => l.net_amount != null);
  if (!withAmount.length) return "unknown";

  const sum = withAmount.reduce((a, l) => a + (l.net_amount || 0), 0);
  const tol = (v: number) => Math.max(0.05, Math.abs(v) * 0.02);

  const net = totals.total_net;
  const gross = totals.total_gross;
  const nearNet = net != null && Math.abs(sum - net) <= tol(net);
  const nearGross = gross != null && Math.abs(sum - gross) <= tol(gross);

  // When both match the document has no VAT (zero-rated), so the distinction
  // does not change the arithmetic — call it net.
  if (nearNet && nearGross) return "net";
  if (nearGross) return "gross";
  if (nearNet) return "net";
  // Neither total reconciles cleanly with the line sum — extraction missed
  // something (a line, a discount, a quantity) and we can't anchor exactly.
  // But retail/e-commerce receipts (supermarkets, fuel stations, Temu-style
  // orders) print the VAT-inclusive line price far more often than a bare
  // net figure, which is the whole reason this file exists (see header
  // comment) — so when the document's own gross total is at least known,
  // read the lines as gross rather than silently defaulting to net. Guessing
  // net when the lines are actually gross overclaims VAT by the rate itself;
  // guessing gross when they're actually net only underclaims — the safer
  // direction to be wrong in.
  if (gross != null) return "gross";
  return "unknown";
}

/** VAT for one line on a known basis. Negative lines (discounts) carry through. */
export function lineVat(l: VatLine, basis: Basis, fallbackRate: number | null = null): number {
  if (l.vat_amount_on_invoice != null) return r2(l.vat_amount_on_invoice);
  const rate = rateOf(l) ?? fallbackRate;
  if (l.net_amount == null || rate == null) return 0;
  // "unknown" is treated as net: it is the lower-risk reading, since assuming
  // gross would inflate the net base instead.
  return basis === "gross"
    ? r2((l.net_amount * rate) / (100 + rate))
    : r2((l.net_amount * rate) / 100);
}

/**
 * Rate to assume for a line the reader left without one — typically a discount
 * such as "2 FOR €5". It is the amount-weighted average of the rates actually
 * present on the document, so on a single-rate receipt it simply is that rate,
 * and on a mixed one the discount is shared in proportion to each rate's share.
 *
 * Leaving these at zero would be wrong in the client's favour: the discount
 * would stop reducing the reclaimable VAT.
 */
export function blendedRate(lines: VatLine[]): number | null {
  let weighted = 0, base = 0;
  for (const l of lines) {
    const rate = rateOf(l);
    if (rate == null || l.net_amount == null) continue;
    const amount = Math.abs(l.net_amount);
    weighted += amount * rate;
    base += amount;
  }
  return base > 0 ? weighted / base : null;
}

export interface ComputedLine {
  vat: number;
  /** Net of VAT, useful when the source line was gross. */
  net: number;
}

/**
 * Computes VAT for every line and, when the document states a total VAT,
 * anchors the lines to it: the per-line figures are scaled so they add up to
 * the printed total, absorbing rounding and any rate the reader mis-read.
 *
 * Anchoring is what makes partial credit safe. Claiming only some lines takes
 * each line's own share of the stated VAT, so the claim can never exceed what
 * the supplier actually charged.
 */
export function computeLines(lines: VatLine[], totals: DocTotals): {
  basis: Basis;
  anchored: boolean;
  lines: ComputedLine[];
} {
  const basis = detectBasis(lines, totals);
  // Fill rate-less lines first, so a discount reduces the claim on its own
  // merits instead of having its effect smeared across every other line by the
  // anchoring step below.
  const fallback = blendedRate(lines);
  let vats = lines.map((l) => lineVat(l, basis, fallback));

  const stated = totals.total_vat;
  const sum = vats.reduce((a, v) => a + v, 0);
  let anchored = false;

  // Only rescale when there is something to scale and the gap is real but not
  // absurd — a wildly different total means the read is wrong, not rounded,
  // and silently forcing a match would hide that.
  if (stated != null && Math.abs(sum) > 0.005) {
    const ratio = stated / sum;
    if (ratio > 0.5 && ratio < 2) {
      vats = vats.map((v) => r2(v * ratio));
      anchored = true;

      // Push the last cent of rounding drift onto the largest line so the
      // parts add up to the printed total exactly.
      const drift = r2(stated - vats.reduce((a, v) => a + v, 0));
      if (drift !== 0) {
        let big = 0;
        vats.forEach((v, i) => { if (Math.abs(v) > Math.abs(vats[big])) big = i; });
        vats[big] = r2(vats[big] + drift);
      }
    }
  }

  return {
    basis,
    anchored,
    lines: lines.map((l, i) => ({
      vat: vats[i],
      net: basis === "gross" ? r2((l.net_amount || 0) - vats[i]) : r2(l.net_amount || 0),
    })),
  };
}

/**
 * VAT of the lines flagged for credit. `takeCredit` is read per index so the
 * caller keeps ownership of the eligibility decision — this function only does
 * arithmetic, never tax judgement.
 */
export function creditTotal(
  lines: VatLine[],
  totals: DocTotals,
  takeCredit: (index: number) => boolean
): number {
  const { lines: computed } = computeLines(lines, totals);
  return r2(computed.reduce((a, c, i) => a + (takeCredit(i) ? c.vat : 0), 0));
}
