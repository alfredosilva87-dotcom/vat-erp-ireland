import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { EXTRACTION_INSTRUCTION, BOUNDARY_INSTRUCTION, coerceExtraction } from "./prompt";
import { waitDecision } from "./quotaWait";
import { SALES_SHEET_INSTRUCTION, coerceSalesSheet, type SheetSale } from "./salesSheet";
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

// Erro de cota (429) vem com o tempo exato que o Google pede pra esperar
// (`"retryDelay":"38s"` no corpo do erro). É o limite de 15 requisições por
// minuto do plano gratuito — não é limite mensal, reseta sozinho — então uma
// segunda tentativa DEPOIS desse tempo costuma passar.
// A decisão de esperar (e por quanto) mora em ./quotaWait.ts, sem rede e com
// teste — ver o comentário de lá sobre a leitura de 3,5 minutos.

async function callModel(name: string, parts: Part[]): Promise<string> {
  const model = client().getGenerativeModel({
    model: name,
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });
  const res = await model.generateContent(parts);
  return res.response.text();
}

// Run the model cascade and return the raw JSON text.
async function runModels(parts: Part[]): Promise<string> {
  const models = modelList();
  let lastErr: unknown;
  let waitedMs = 0;
  for (const name of models) {
    try {
      return await callModel(name, parts);
    } catch (err) {
      lastErr = err;
      const waitMs = waitDecision(err, waitedMs);
      if (waitMs !== null) {
        waitedMs += waitMs;
        await new Promise((r) => setTimeout(r, waitMs));
        try {
          return await callModel(name, parts);
        } catch (err2) {
          lastErr = err2;
          if (isRetriable(err2)) continue;
          throw err2;
        }
      }
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

/**
 * Lê uma PLANILHA de vendas fotografada: uma linha por venda.
 *
 * Caminho separado do leitor de nota porque a saída é outra — ver
 * lib/extractor/salesSheet.ts. Sempre por visão: planilha fotografada não tem
 * camada de texto, e mesmo em PDF as colunas saem embaralhadas na extração de
 * texto, o que aqui trocaria valores de linha.
 */
export async function structureSalesSheet(
  base64: string,
  mimeType: string
): Promise<SheetSale[]> {
  return coerceSalesSheet(
    await runModels([
      { text: SALES_SHEET_INSTRUCTION },
      { inlineData: { data: base64, mimeType } },
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

/**
 * Extrato bancário escaneado (camada A6).
 *
 * Só entra quando o PDF não tem camada de texto — o caminho normal
 * (`lib/pdfStatement.ts`) é grátis, determinístico e conferível, e este não é
 * nenhuma das três coisas. Por isso o resultado volta marcado como vindo de IA:
 * a tela pede confirmação linha a linha antes de gravar.
 *
 * O modelo é instruído a NÃO inventar sinal: o que ele devolve é o que está
 * impresso, e a coluna (saída/entrada) vem declarada à parte.
 */
export async function statementRowsFromMedia(
  base64: string,
  mimeType: string
): Promise<Array<{ date: string; description: string; amount: number | null; balance: number | null }>> {
  const instruction = `You are reading a BANK STATEMENT. Return every transaction row you can see.

Rules:
- "date": ISO yyyy-mm-dd. Use the transaction/posting date printed on the row.
- "description": the narrative exactly as printed, joined into one line.
- "amount": the movement as a SIGNED number — negative when money leaves the
  account (debit, paid out, withdrawal), positive when money arrives (credit,
  paid in, lodgement). Use the column headings to decide. Never guess: if the
  statement has a single amount column and no sign, keep the printed sign.
- "balance": the running balance printed on that row, or null.
- Skip headers, page footers, totals and opening/closing balance lines.
- Do NOT invent rows. If a value is unreadable, use null.

Return STRICT JSON only:
{"lines":[{"date":"2026-01-02","description":"TESCO STORES","amount":-45.20,"balance":954.80}]}`;

  const text = await runModels([
    { text: instruction },
    { inlineData: { data: base64, mimeType } },
  ]);

  try {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed?.lines) ? parsed.lines : [];
    return arr
      .map((l: any) => ({
        date: String(l?.date ?? "").slice(0, 10),
        description: String(l?.description ?? "").trim(),
        amount: Number.isFinite(Number(l?.amount)) ? Number(l.amount) : null,
        balance: Number.isFinite(Number(l?.balance)) ? Number(l.balance) : null,
      }))
      .filter((l: any) => /^\d{4}-\d{2}-\d{2}$/.test(l.date) && l.amount !== null);
  } catch {
    return [];
  }
}
