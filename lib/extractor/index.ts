import type { ExtractionResult, RawExtraction } from "@/lib/types";
import { extractPdfText } from "./pdfNative";
import { structureFromText, structureFromMedia, detectDocumentBoundaries } from "./gemini";
import { ocrImage } from "./tesseract";
import { coerceExtraction } from "./prompt";
import { scoreExtraction, ESCALATION_THRESHOLD, REVIEW_THRESHOLD } from "./validate";
import { pdfPageCount, extractPdfPageRange } from "./splitPdf";

const hasGemini = () => Boolean(process.env.GEMINI_API_KEY);

function result(
  engine: ExtractionResult["engine"],
  data: RawExtraction,
  score: number,
  issues: string[],
  audit: ExtractionResult["audit"] = [{ engine, confidence: score }]
): ExtractionResult {
  return { engine, confidence: score, needs_review: score < REVIEW_THRESHOLD, issues, audit, data };
}

/**
 * Pluggable reading pipeline.
 *
 *   PDF with text layer  -> free text extract + Gemini structuring, validated;
 *                            escalates to Gemini vision if the score doesn't
 *                            clear ESCALATION_THRESHOLD                        (engine: pdf-native | gemini-vision)
 *   scanned PDF / image  -> Gemini vision, validated                          (engine: gemini-vision)
 *   image, no Gemini key -> Tesseract OCR + naive structuring, validated      (engine: tesseract)
 *
 * `confidence` is always a REAL score computed from the extracted content
 * (lib/extractor/validate.ts) — sums reconcile, VAT rates are plausible,
 * dates make sense — never a fixed per-engine number. `needs_review` is set
 * whenever even the best available read doesn't clear REVIEW_THRESHOLD, so
 * low-confidence reads are never silently accepted.
 */
export async function readDocument(
  buffer: Buffer,
  mimeType: string
): Promise<ExtractionResult> {
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");

  // 1. PDF ------------------------------------------------------------------
  if (isPdf) {
    const text = await extractPdfText(buffer);

    // STAGE 1 — read the PDF text layer (cheap, no image).
    if (text && hasGemini()) {
      const data = await structureFromText(text);
      const { score, issues } = scoreExtraction(data);
      if (score >= ESCALATION_THRESHOLD) {
        return result("pdf-native", data, score, issues);
      }
      // Text read isn't confident enough -> escalate to vision (reads the
      // actual layout instead of pdf-parse's possibly-scrambled text order).
      const visionData = await structureFromMedia(buffer.toString("base64"), mimeType);
      const visionScored = scoreExtraction(visionData);
      const audit: ExtractionResult["audit"] = [
        { engine: "pdf-native", confidence: score },
        { engine: "gemini-vision", confidence: visionScored.score },
      ];
      if (visionScored.score >= score) {
        return result("gemini-vision", visionData, visionScored.score, visionScored.issues, audit);
      }
      return result("pdf-native", data, score, issues, audit);
    }
    if (text && !hasGemini()) {
      const data = coerceExtraction(naiveTextToJson(text));
      const { score, issues } = scoreExtraction(data);
      return result("pdf-native", data, score, issues);
    }

    // No text layer (scanned PDF) -> STAGE 2, vision.
    if (hasGemini()) {
      const data = await structureFromMedia(buffer.toString("base64"), mimeType);
      const { score, issues } = scoreExtraction(data);
      return result("gemini-vision", data, score, issues);
    }
    throw new Error(
      "This PDF appears to be scanned and needs vision reading. Set GEMINI_API_KEY in .env.local."
    );
  }

  // 2. Images ----------------------------------------------------------------
  if (isImage) {
    if (hasGemini()) {
      const data = await structureFromMedia(buffer.toString("base64"), mimeType);
      const { score, issues } = scoreExtraction(data);
      return result("gemini-vision", data, score, issues);
    }
    const text = await ocrImage(buffer);
    const data = coerceExtraction(naiveTextToJson(text));
    const { score, issues } = scoreExtraction(data);
    return result("tesseract", data, score, issues);
  }

  throw new Error(`Unsupported file type: ${mimeType}. Upload a PDF or an image.`);
}

export interface SplitDocument {
  result: ExtractionResult;
  /** 1-indexed, inclusive; null when the source wasn't split (single document). */
  page_range: [number, number] | null;
  /** The split-out PDF bytes; null when the source wasn't split — caller reuses the original upload. */
  buffer: Buffer | null;
}

/**
 * Like readDocument, but first checks whether a multi-page PDF is actually a
 * batch of several invoices/receipts scanned back-to-back (e.g. a client
 * dropping 40 notes into one file) and, if so, splits it and reads each one
 * through the same pipeline independently.
 *
 * Costs exactly one extra Gemini call, and only for PDFs with more than one
 * page — a normal single-page receipt or image never touches this path.
 */
export async function readDocuments(buffer: Buffer, mimeType: string): Promise<SplitDocument[]> {
  const single = async (): Promise<SplitDocument[]> => [
    { result: await readDocument(buffer, mimeType), page_range: null, buffer: null },
  ];

  if (mimeType !== "application/pdf" || !hasGemini()) return single();

  let pageCount = 1;
  try {
    pageCount = await pdfPageCount(buffer);
  } catch {
    return single(); // corrupt/encrypted page count — fall back to the normal single-document read.
  }
  if (pageCount <= 1) return single();

  const boundaries = await detectDocumentBoundaries(buffer.toString("base64"), mimeType);
  if (boundaries.length <= 1) return single();

  const out: SplitDocument[] = [];
  for (const b of boundaries) {
    const sub = await extractPdfPageRange(buffer, b.page_start, b.page_end);
    const result = await readDocument(sub, mimeType);
    out.push({ result, page_range: [b.page_start, b.page_end], buffer: sub });
  }
  return out;
}

// Extremely basic offline fallback: wraps raw text as a single description so
// the user at least sees something to correct. Real structuring needs Gemini.
function naiveTextToJson(text: string) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    supplier_name: lines[0] ?? null,
    doc_type: "receipt",
    items: lines.slice(1, 60).map((l) => ({ description: l })),
  };
}
