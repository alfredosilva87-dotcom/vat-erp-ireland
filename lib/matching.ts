import type {
  AnalyzedItem,
  CreditRule,
  MatchSource,
  RawExtraction,
  RawItem,
  VatCategory,
} from "@/lib/types";

// Bundles the per-client inputs credit suggestion needs, instead of passing
// activityCode/rules/defaultCreditUnmatched as separate positional params
// through every function in this file.
export interface CreditContext {
  activityCode: string;
  rules: CreditRule[];
  // What to suggest when NO rule (block or activity-specific) matches at
  // all. Defaults to false (today's behaviour: unmatched items start
  // unchecked, the accountant reviews) unless the client opted in.
  defaultCreditUnmatched: boolean;
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Light stemmer: drop a trailing plural "s" on words longer than 3 chars.
const stem = (t: string) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t);

const tokenize = (s: string): Set<string> =>
  new Set(
    norm(s)
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map(stem)
  );

// --- de-para: match an item description to a VAT category -------------------
// Whole-word / phrase matching so "tea" no longer matches "s-tea-k".
function matchCategory(
  description: string,
  invoiceDate: string | null,
  categories: VatCategory[]
): { category: VatCategory | null; confidence: number } {
  const tokens = tokenize(description);
  const descNorm = norm(description);
  let best: VatCategory | null = null;
  let bestScore = 0;

  for (const cat of categories) {
    if (!cat.active) continue;
    if (invoiceDate) {
      if (cat.effective_from && invoiceDate < cat.effective_from) continue;
      if (cat.effective_to && invoiceDate > cat.effective_to) continue;
    }
    let score = 0;
    for (const kw of cat.keywords) {
      const k = norm(kw);
      if (!k || k === "*") continue;
      if (k.includes(" ")) {
        // multi-word keyword: require the phrase to appear
        if (descNorm.includes(k)) score += Math.min(k.length, 16);
      } else {
        // single word: must appear as a whole token (plural-tolerant)
        if (tokens.has(stem(k))) score += Math.min(k.length, 12);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }

  const confidence = best ? Math.min(1, 0.4 + bestScore / 24) : 0;
  return { category: best, confidence };
}

// --- credit suggestion by company activity ---------------------------------
function suggestCredit(
  description: string,
  category: VatCategory | null,
  ctx: CreditContext
): { suggested: boolean | null; rationale: string | null } {
  // Keywords are matched against the item text AND the category the reader
  // assigned. Receipt descriptions are cryptic ("milesPLUS C", "PRNGLE POP
  // BBQ"), so the category is often the only place the real nature of the
  // purchase appears — matching description alone let fuel slip past the
  // petrol block.
  const haystack = [description, category?.description ?? ""].filter(Boolean).join(" ");
  const tokens = tokenize(haystack);
  const descNorm = norm(haystack);
  const applicable = ctx.rules
    .filter((r) => r.active && (r.activity_code === ctx.activityCode || r.activity_code === "*"))
    // Defensive: ignore any literal catch-all rule (match_keywords === ["*"])
    // even if one exists in the data — the client's own
    // defaultCreditUnmatched is the single source of truth for "nothing
    // matched", set below once the loop finds no specific hit.
    .filter((r) => !(r.match_keywords.length === 1 && r.match_keywords[0] === "*"))
    .sort((a, b) => a.priority - b.priority);

  for (const rule of applicable) {
    if (rule.vat_category_id && category && rule.vat_category_id === category.id) {
      return { suggested: rule.deductible_default, rationale: rule.rationale };
    }
    for (const kw of rule.match_keywords) {
      const k = norm(kw);
      if (!k) continue;
      const hit = k.includes(" ") ? descNorm.includes(k) : tokens.has(stem(k));
      if (hit) return { suggested: rule.deductible_default, rationale: rule.rationale };
    }
  }

  return {
    suggested: ctx.defaultCreditUnmatched,
    rationale: ctx.defaultCreditUnmatched
      ? "No specific rule for this business type — using this client's default (auto-credit)."
      : "No specific rule — review manually before taking credit.",
  };
}

// Build an analyzed item from a chosen category (used by both keyword & AI paths).
function build(
  item: RawItem,
  category: VatCategory | null,
  confidence: number,
  source: MatchSource,
  invoiceDate: string | null,
  ctx: CreditContext
): AnalyzedItem {
  const expected = category ? category.vat_rate : null;

  let flag: AnalyzedItem["inconsistency"];
  if (!category) flag = "unmatched";
  else if (item.vat_rate_on_invoice === null) flag = "no_vat_on_doc";
  else if (Math.abs(item.vat_rate_on_invoice - (expected ?? -999)) > 0.01) flag = "rate_mismatch";
  else flag = "ok";

  const credit = suggestCredit(item.description, category, ctx);

  return {
    ...item,
    matched_category: category,
    expected_vat_rate: expected,
    match_confidence: Number(confidence.toFixed(2)),
    match_source: source,
    inconsistency: flag,
    credit_suggested: credit.suggested,
    credit_rationale: credit.rationale,
    take_credit: credit.suggested,
  };
}

export function analyzeItem(
  item: RawItem,
  invoiceDate: string | null,
  ctx: CreditContext,
  categories: VatCategory[]
): AnalyzedItem {
  const { category, confidence } = matchCategory(item.description, invoiceDate, categories);
  return build(item, category, confidence, category ? "keyword" : "none", invoiceDate, ctx);
}

// Re-apply an AI-chosen category to an already-analyzed item.
export function applyAiCategory(
  item: AnalyzedItem,
  category: VatCategory,
  invoiceDate: string | null,
  ctx: CreditContext
): AnalyzedItem {
  return build(item, category, 0.7, "ai", invoiceDate, ctx);
}

export function analyzeExtraction(
  extraction: RawExtraction,
  ctx: CreditContext,
  categories: VatCategory[]
): AnalyzedItem[] {
  return extraction.items.map((it) =>
    analyzeItem(it, extraction.invoice_date, ctx, categories)
  );
}

// Apply a category chosen by a non-keyword source (learned cache or AI).
export function applyCategoryFromSource(
  item: AnalyzedItem,
  category: VatCategory,
  source: MatchSource,
  invoiceDate: string | null,
  ctx: CreditContext
): AnalyzedItem {
  const confidence = source === "learned" ? 0.9 : 0.7;
  return build(item, category, confidence, source, invoiceDate, ctx);
}
