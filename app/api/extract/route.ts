import { NextRequest, NextResponse } from "next/server";
import { readDocuments } from "@/lib/extractor";
import type { SplitDocument } from "@/lib/extractor";
import { classifyItems } from "@/lib/extractor/gemini";
import { analyzeExtraction, applyCategoryFromSource, creditRiskSummary, categoryRelationSummary } from "@/lib/matching";
import type { CreditContext } from "@/lib/matching";
import { loadBase } from "@/lib/loadBase";
import { lookupMasterCategories } from "@/lib/store";
import type { ExtractionResult, VatCategory } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACCEPTED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const hasGemini = () => Boolean(process.env.GEMINI_API_KEY);

// Category de-para (keyword -> learning cache -> AI) plus the risk/relation
// checks, run once per document. Factored out so a batch PDF that splits
// into N invoices classifies each one independently, exactly like a single
// upload always has.
async function classifyDocument(
  extraction: ExtractionResult,
  categories: VatCategory[],
  creditCtx: CreditContext,
  relatedCategories: string[]
) {
  const invoiceDate = extraction.data.invoice_date;
  let items = analyzeExtraction(extraction.data, creditCtx, categories);

  const byRef = new Map<string, VatCategory>();
  categories.forEach((c) => byRef.set(c.code || c.id, c));
  const unmatched = () => items.map((it, i) => (it.matched_category ? -1 : i)).filter((i) => i >= 0);

  let cacheUsed = 0;
  {
    const idxs = unmatched();
    if (idxs.length) {
      const learned = await lookupMasterCategories(idxs.map((i) => items[i].description));
      idxs.forEach((idx, k) => {
        const code = learned[k];
        const cat = code ? byRef.get(code) : undefined;
        if (cat) {
          items[idx] = applyCategoryFromSource(items[idx], cat, "learned", invoiceDate, creditCtx);
          cacheUsed++;
        }
      });
    }
  }

  let aiUsed = 0;
  if (hasGemini()) {
    const idxs = unmatched();
    if (idxs.length) {
      const catRefs = categories.map((c) => ({ ref: c.code || c.id, description: c.description, vat_rate: c.vat_rate }));
      try {
        const codes = await classifyItems(idxs.map((i) => items[i].description), catRefs);
        idxs.forEach((idx, k) => {
          const cat = codes[k] ? byRef.get(codes[k]!) : undefined;
          if (cat) {
            items[idx] = applyCategoryFromSource(items[idx], cat, "ai", invoiceDate, creditCtx);
            aiUsed++;
          }
        });
      } catch {
        /* AI is best-effort; keep prior results on failure */
      }
    }
  }

  const risk = creditRiskSummary(items);
  const relation = categoryRelationSummary(items, relatedCategories);

  return {
    engine: extraction.engine,
    confidence: extraction.confidence,
    needs_review: extraction.needs_review || risk.needsReview || relation.needsReview,
    issues: [...extraction.issues, ...risk.issues, ...relation.issues],
    audit: extraction.audit,
    cache_matched: cacheUsed,
    ai_matched: aiUsed,
    header: {
      supplier_name: extraction.data.supplier_name,
      store_name: extraction.data.store_name,
      supplier_vat: extraction.data.supplier_vat,
      invoice_number: extraction.data.invoice_number,
      barcode: extraction.data.barcode,
      invoice_date: extraction.data.invoice_date,
      invoice_time: extraction.data.invoice_time,
      doc_type: extraction.data.doc_type,
      total_net: extraction.data.total_net,
      total_vat: extraction.data.total_vat,
      total_gross: extraction.data.total_gross,
    },
    items,
  };
}

function splitFilename(original: string, idx: number, total: number): string {
  const base = original.replace(/\.pdf$/i, "");
  return `${base} (${idx} of ${total}).pdf`;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const activityCode = String(form.get("activity_code") || "*");
    const defaultCreditUnmatched = form.get("default_credit_unmatched") === "true";
    let relatedCategories: string[] = [];
    try { relatedCategories = JSON.parse(String(form.get("related_categories") || "[]")); } catch { /* ignore malformed input */ }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    const mimeType = file.type || "application/octet-stream";
    if (!ACCEPTED.includes(mimeType)) {
      return NextResponse.json(
        { error: `Unsupported type "${mimeType}". Upload PDF, PNG, JPEG or WebP.` },
        { status: 415 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Reads the document — transparently splitting a batch PDF (several
    // invoices scanned back-to-back) into one entry per invoice.
    const splitDocs: SplitDocument[] = await readDocuments(buffer, mimeType);
    const { categories, rules, source } = await loadBase();
    const creditCtx: CreditContext = { activityCode, rules, defaultCreditUnmatched };

    const documents = await Promise.all(
      splitDocs.map(async (sd, i) => {
        const classified = await classifyDocument(sd.result, categories, creditCtx, relatedCategories);
        return {
          filename: splitDocs.length > 1 ? splitFilename(file.name, i + 1, splitDocs.length) : file.name,
          page_range: sd.page_range,
          pdf_base64: sd.buffer ? sd.buffer.toString("base64") : null,
          base_source: source,
          ...classified,
        };
      })
    );

    return NextResponse.json({ documents });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to read the document." },
      { status: 500 }
    );
  }
}
