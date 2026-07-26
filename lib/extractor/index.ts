import type { ExtractionResult } from "@/lib/types";
import { extractPdfText } from "./pdfNative";
import { structureFromText, structureFromMedia } from "./gemini";
import { ocrImage } from "./tesseract";
import { coerceExtraction } from "./prompt";

const hasGemini = () => Boolean(process.env.GEMINI_API_KEY);

/**
 * Pluggable reading pipeline.
 *
 *   PDF with text layer  -> free text extract + Gemini structuring   (engine: pdf-native)
 *   scanned PDF / image  -> Gemini vision                            (engine: gemini-vision)
 *   image, no Gemini key -> Tesseract OCR + naive structuring        (engine: tesseract)
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
      if (data.items.length) {
        return { engine: "pdf-native", confidence: 0.85, data };
      }
      // Stage 1 read the text but couldn't structure any items -> STAGE 2.
      const v = await structureFromMedia(buffer.toString("base64"), mimeType);
      return { engine: "gemini-vision", confidence: v.items.length ? 0.8 : 0.4, data: v };
    }
    if (text && !hasGemini()) {
      const data = coerceExtraction(naiveTextToJson(text));
      return { engine: "pdf-native", confidence: 0.35, data };
    }

    // No text layer (scanned PDF) -> STAGE 2, vision.
    if (hasGemini()) {
      const data = await structureFromMedia(buffer.toString("base64"), mimeType);
      return { engine: "gemini-vision", confidence: data.items.length ? 0.8 : 0.4, data };
    }
    throw new Error(
      "This PDF appears to be scanned and needs vision reading. Set GEMINI_API_KEY in .env.local."
    );
  }

  // 2. Images ----------------------------------------------------------------
  if (isImage) {
    if (hasGemini()) {
      const data = await structureFromMedia(buffer.toString("base64"), mimeType);
      return { engine: "gemini-vision", confidence: data.items.length ? 0.8 : 0.4, data };
    }
    const text = await ocrImage(buffer);
    const data = coerceExtraction(naiveTextToJson(text));
    return { engine: "tesseract", confidence: 0.3, data };
  }

  throw new Error(`Unsupported file type: ${mimeType}. Upload a PDF or an image.`);
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
