import { NextRequest, NextResponse } from "next/server";
import { getDocumentDownload } from "@/lib/store";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const doc = await getDocumentDownload(params.id);
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(doc.bytes), {
    status: 200,
    headers: {
      "Content-Type": MIME[doc.ext] || "application/octet-stream",
      "Content-Disposition": `inline; filename="document.${doc.ext}"`,
    },
  });
}
