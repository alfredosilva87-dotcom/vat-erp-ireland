import { NextRequest, NextResponse } from "next/server";
import { readDocument } from "@/lib/extractor";
import { classifyItems } from "@/lib/extractor/gemini";
import { analyzeExtraction, applyCategoryFromSource } from "@/lib/matching";
import { loadBase } from "@/lib/loadBase";
import { lookupMasterCategories } from "@/lib/store";
import type { VatCategory } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACCEPTED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const hasGemini = () => Boolean(process.env.GEMINI_API_KEY);

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const activityCode = String(form.get("activity_code") || "*");

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

    // 1. Read the document.
    const extraction = await readDocument(buffer, mimeType);
    const invoiceDate = extraction.data.invoice_date;

    // 2. Keyword de-para against the base.
    const { categories, rules, source } = await loadBase();
    let items = analyzeExtraction(extraction.data, activityCode, categories, rules);

    // code/id -> category, to resolve learned/AI picks against the live base
    const byRef = new Map<string, VatCategory>();
    categories.forEach((c) => byRef.set(c.code || c.id, c));

    const unmatched = () =>
      items.map((it, i) => (it.matched_category ? -1 : i)).filter((i) => i >= 0);

    // 3. Learning cache: reuse categories already learned (FREE, no AI call).
    let cacheUsed = 0;
    {
      const idxs = unmatched();
      if (idxs.length) {
        const learned = lookupMasterCategories(idxs.map((i) => items[i].description));
        idxs.forEach((idx, k) => {
          const code = learned[k];
          const cat = code ? byRef.get(code) : undefined;
          if (cat) {
            items[idx] = applyCategoryFromSource(items[idx], cat, "learned", invoiceDate, activityCode, rules);
            cacheUsed++;
          }
        });
      }
    }

    // 4. AI de-para only for what is STILL unmatched.
    let aiUsed = 0;
    if (hasGemini()) {
      const idxs = unmatched();
      if (idxs.length) {
        const catRefs = categories.map((c) => ({
          ref: c.code || c.id,
          description: c.description,
          vat_rate: c.vat_rate,
        }));
        try {
          const codes = await classifyItems(idxs.map((i) => items[i].description), catRefs);
          idxs.forEach((idx, k) => {
            const cat = codes[k] ? byRef.get(codes[k]!) : undefined;
            if (cat) {
              items[idx] = applyCategoryFromSource(items[idx], cat, "ai", invoiceDate, activityCode, rules);
              aiUsed++;
            }
          });
        } catch {
          /* AI is best-effort; keep prior results on failure */
        }
      }
    }

    return NextResponse.json({
      filename: file.name,
      engine: extraction.engine,
      confidence: extraction.confidence,
      base_source: source,
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
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to read the document." },
      { status: 500 }
    );
  }
}
