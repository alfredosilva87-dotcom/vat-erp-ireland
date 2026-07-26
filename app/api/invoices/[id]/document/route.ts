import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { getDocumentAbsolutePath } from "@/lib/store";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const abs = getDocumentAbsolutePath(params.id);
  if (!abs || !fs.existsSync(abs)) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  const ext = abs.split(".").pop()?.toLowerCase() || "bin";
  const data = fs.readFileSync(abs);
  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Disposition": `inline; filename="document.${ext}"`,
    },
  });
}
