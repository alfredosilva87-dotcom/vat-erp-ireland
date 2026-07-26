// Optional offline OCR fallback. Used only when no GEMINI_API_KEY is configured
// and the input is an image. Kept as an optional dependency to keep installs
// light — install with:  npm i tesseract.js
//
// Note: OCR quality on real-world receipts is far below Gemini vision; this is a
// last resort so the app still degrades gracefully offline.

export async function ocrImage(buffer: Buffer): Promise<string> {
  let Tesseract: any;
  try {
    // @ts-ignore - optional dependency, may not be installed
    Tesseract = await import("tesseract.js");
  } catch {
    throw new Error(
      "Offline OCR requires tesseract.js. Either set GEMINI_API_KEY (recommended) or run: npm i tesseract.js"
    );
  }
  const { data } = await Tesseract.recognize(buffer, "eng");
  return (data?.text || "").trim();
}
