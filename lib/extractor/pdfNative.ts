// Free path: extract embedded text from a native (digital) PDF.
// Returns null when the PDF has no meaningful text layer (i.e. it is scanned).

export async function extractPdfText(buffer: Buffer): Promise<string | null> {
  // pdf-parse is CommonJS; import lazily so it only loads on the server.
  const pdfParse = (await import("pdf-parse")).default;
  try {
    const result = await pdfParse(buffer);
    const text = (result.text || "").trim();
    // Heuristic: a scanned PDF yields little or no extractable text.
    if (text.replace(/\s/g, "").length < 40) return null;
    return text;
  } catch {
    return null;
  }
}
