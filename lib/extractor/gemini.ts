import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { EXTRACTION_INSTRUCTION, BOUNDARY_INSTRUCTION, coerceExtraction } from "./prompt";
import type { RawExtraction } from "@/lib/types";

function client() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in .env.local");
  return new GoogleGenerativeAI(key);
}

// Model cascade: the first that works wins. Gemini deprecates models often.
const FALLBACK_MODELS = [
  "gemini-flash-latest",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-2.0-flash",
  "gemini-flash-lite-latest",
];

function modelList(): string[] {
  const preferred = process.env.GEMINI_MODEL?.trim();
  const list = preferred ? [preferred, ...FALLBACK_MODELS] : [...FALLBACK_MODELS];
  return Array.from(new Set(list));
}

function isRetriable(err: unknown): boolean {
  const m = String((err as any)?.message || err).toLowerCase();
  return (
    m.includes("404") ||
    m.includes("not found") ||
    m.includes("no longer available") ||
    m.includes("not supported") ||
    m.includes("429") ||
    m.includes("quota") ||
    m.includes("resource has been exhausted") ||
    m.includes("overloaded") ||
    m.includes("503")
  );
}

// Run the model cascade and return the raw JSON text.
async function runModels(parts: Part[]): Promise<string> {
  const models = modelList();
  let lastErr: unknown;
  for (const name of models) {
    try {
      const model = client().getGenerativeModel({
        model: name,
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      });
      const res = await model.generateContent(parts);
      return res.response.text();
    } catch (err) {
      lastErr = err;
      if (isRetriable(err)) continue;
      throw err;
    }
  }
  throw new Error(
    `All Gemini models failed or are rate-limited (tried: ${models.join(", ")}). ` +
      `Last error: ${String((lastErr as any)?.message || lastErr)}`
  );
}

export async function structureFromText(text: string): Promise<RawExtraction> {
  return coerceExtraction(
    await runModels([
      { text: EXTRACTION_INSTRUCTION },
      { text: `\n\nDOCUMENT TEXT:\n${text}` },
    ])
  );
}

export async function structureFromMedia(
  base64: string,
  mimeType: string
): Promise<RawExtraction> {
  return coerceExtraction(
    await runModels([
      { text: EXTRACTION_INSTRUCTION },
      { inlineData: { data: base64, mimeType } },
    ])
  );
}

// Detects how many separate invoices a multi-page PDF contains and their page
// ranges. Empty/single-range results mean "treat it as one document" — the
// caller falls back to the normal single-document pipeline either way.
export async function detectDocumentBoundaries(
  base64: string,
  mimeType: string
): Promise<{ page_start: number; page_end: number }[]> {
  try {
    const text = await runModels([
      { text: BOUNDARY_INSTRUCTION },
      { inlineData: { data: base64, mimeType } },
    ]);
    const parsed = JSON.parse(text);
    const docs = Array.isArray(parsed?.documents) ? parsed.documents : [];
    return docs
      .map((d: any) => ({ page_start: Number(d?.page_start), page_end: Number(d?.page_end) }))
      .filter(
        (d: { page_start: number; page_end: number }) =>
          Number.isInteger(d.page_start) && Number.isInteger(d.page_end) && d.page_start >= 1 && d.page_end >= d.page_start
      );
  } catch {
    return [];
  }
}

// AI-assisted de-para: map item descriptions to one of our category refs.
// Returns an array aligned to `descriptions`, each a category ref or null.
export async function classifyItems(
  descriptions: string[],
  categories: { ref: string; description: string; vat_rate: number }[]
): Promise<(string | null)[]> {
  if (!descriptions.length || !categories.length) return descriptions.map(() => null);

  const catLines = categories
    .map((c) => `${c.ref} — ${c.description} (${c.vat_rate}%)`)
    .join("\n");
  const itemLines = descriptions.map((d, i) => `${i}: ${d}`).join("\n");

  const prompt = `You map Irish supermarket/invoice line items to VAT categories.
Choose the single best category CODE for each item, or "NONE" if none fits.
Item descriptions may be abbreviated (e.g. "T. WINGS" = chicken wings, "LARDONS" = bacon lardons).

CATEGORIES (CODE — description (rate)):
${catLines}

ITEMS:
${itemLines}

Return STRICT JSON only:
{"assignments":[{"i":0,"code":"CODE_OR_NONE"}, ...]}  (one entry per item index)`;

  const text = await runModels([{ text: prompt }]);
  const out: (string | null)[] = descriptions.map(() => null);
  try {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed?.assignments) ? parsed.assignments : [];
    for (const a of arr) {
      const i = Number(a?.i);
      const code = String(a?.code || "").trim();
      if (Number.isInteger(i) && i >= 0 && i < out.length && code && code !== "NONE") {
        out[i] = code;
      }
    }
  } catch {
    /* leave as nulls on parse failure */
  }
  return out;
}
