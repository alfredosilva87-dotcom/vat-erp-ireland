import type {
  AnalyzedItem,
  CreditRule,
  MatchSource,
  RawExtraction,
  RawItem,
  VatCategory,
} from "@/lib/types";

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
  activityCode: string,
  rules: CreditRule[]
): { suggested: boolean | null; rationale: string | null } {
  const tokens = tokenize(description);
  const descNorm = norm(description);
  const applicable = rules
    .filter((r) => r.active && (r.activity_code === activityCode || r.activity_code === "*"))
    .sort((a, b) => a.priority - b.priority);

  for (const rule of applicable) {
    if (rule.vat_category_id && category && rule.vat_category_id === category.id) {
      return { suggested: rule.deductible_default, rationale: rule.rationale };
    }
    for (const kw of rule.match_keywords) {
      const k = norm(kw);
      if (k === "*") return { suggested: rule.deductible_default, rationale: rule.rationale };
      if (!k) continue;
      const hit = k.includes(" ") ? descNorm.includes(k) : tokens.has(stem(k));
      if (hit) return { suggested: rule.deductible_default, rationale: rule.rationale };
    }
  }
  return { suggested: null, rationale: null };
}

// Build an analyzed item from a chosen category (used by both keyword & AI paths).
function build(
  item: RawItem,
  category: VatCategory | null,
  confidence: number,
  source: MatchSource,
  invoiceDate: string | null,
  activityCode: string,
  rules: CreditRule[]
): AnalyzedItem {
  const expected = category ? category.vat_rate : null;

  let flag: AnalyzedItem["inconsistency"];
  if (!category) flag = "unmatched";
  else if (item.vat_rate_on_invoice === null) flag = "no_vat_on_doc";
  else if (Math.abs(item.vat_rate_on_invoice - (expected ?? -999)) > 0.01) flag = "rate_mismatch";
  else flag = "ok";

  const credit = suggestCredit(item.description, category, activityCode, rules);

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
  activityCode: string,
  categories: VatCategory[],
  rules: CreditRule[]
): AnalyzedItem {
  const { category, confidence } = matchCategory(item.description, invoiceDate, categories);
  return build(item, category, confidence, category ? "keyword" : "none", invoiceDate, activityCode, rules);
}

// Re-apply an AI-chosen category to an already-analyzed item.
export function applyAiCategory(
  item: AnalyzedItem,
  category: VatCategory,
  invoiceDate: string | null,
  activityCode: string,
  rules: CreditRule[]
): AnalyzedItem {
  return build(item, category, 0.7, "ai", invoiceDate, activityCode, rules);
}

export function analyzeExtraction(
  extraction: RawExtraction,
  activityCode: string,
  categories: VatCategory[],
  rules: CreditRule[]
): AnalyzedItem[] {
  return extraction.items.map((it) =>
    analyzeItem(it, extraction.invoice_date, activityCode, categories, rules)
  );
}

// Apply a category chosen by a non-keyword source (learned cache or AI).
export function applyCategoryFromSource(
  item: AnalyzedItem,
  category: VatCategory,
  source: MatchSource,
  invoiceDate: string | null,
  activityCode: string,
  rules: CreditRule[]
): AnalyzedItem {
  const confidence = source === "learned" ? 0.9 : 0.7;
  return build(item, category, confidence, source, invoiceDate, activityCode, rules);
}
