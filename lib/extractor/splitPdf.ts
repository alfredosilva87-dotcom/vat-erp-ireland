// Physically splits a PDF by page range so a batch upload containing several
// invoices back-to-back can be stored as separate documents — each saved
// invoice then opens to just its own page(s) instead of the whole batch.
import { PDFDocument } from "pdf-lib";

export async function pdfPageCount(buffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return doc.getPageCount();
}

/** start/end are 1-indexed, inclusive. */
export async function extractPdfPageRange(buffer: Buffer, start: number, end: number): Promise<Buffer> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const indices: number[] = [];
  for (let p = start; p <= end; p++) indices.push(p - 1);
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  return Buffer.from(bytes);
}
