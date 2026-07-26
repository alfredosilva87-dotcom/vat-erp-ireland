import type { VatCategory, CreditRule } from "@/lib/types";
import { hasSupabaseConfig, getServerSupabase } from "@/lib/supabase";
import { FALLBACK_CATEGORIES } from "@/lib/fallbackBase";
import { listCreditRules } from "@/lib/store";

// Returns the live base from Supabase when configured, otherwise the bundled
// seed so the app is usable immediately with just a Gemini key.
export async function loadBase(): Promise<{
  categories: VatCategory[];
  rules: CreditRule[];
  source: "supabase" | "bundled";
}> {
  if (!hasSupabaseConfig()) {
    return { categories: FALLBACK_CATEGORIES, rules: listCreditRules(), source: "bundled" };
  }
  try {
    const sb = getServerSupabase();
    const [cats, rules] = await Promise.all([
      sb.from("vat_categories").select("*").eq("active", true),
      sb.from("credit_rules").select("*").eq("active", true),
    ]);
    if (cats.error || rules.error || !cats.data?.length) {
      return { categories: FALLBACK_CATEGORIES, rules: listCreditRules(), source: "bundled" };
    }
    return {
      categories: cats.data as VatCategory[],
      rules: (rules.data?.length ? (rules.data as CreditRule[]) : listCreditRules()),
      source: "supabase",
    };
  } catch {
    return { categories: FALLBACK_CATEGORIES, rules: listCreditRules(), source: "bundled" };
  }
}
