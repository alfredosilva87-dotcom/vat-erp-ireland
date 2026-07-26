import { NextRequest, NextResponse } from "next/server";
import { saveInvoice, listInvoices, listMasterItems, stats } from "@/lib/store";
import type { SavePayload } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || undefined;
  const clientId = searchParams.get("client") || undefined;
  const view = searchParams.get("view"); // "items" for de-para master
  if (view === "items") {
    return NextResponse.json({ items: listMasterItems(q), stats: stats(clientId) });
  }
  return NextResponse.json({ invoices: listInvoices(q, clientId), stats: stats(clientId) });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const metaRaw = form.get("meta");
    if (typeof metaRaw !== "string") {
      return NextResponse.json({ error: "Missing meta payload." }, { status: 400 });
    }
    const payload = JSON.parse(metaRaw) as SavePayload;
    if (!payload?.items?.length) {
      return NextResponse.json({ error: "No items to save." }, { status: 400 });
    }

    const file = form.get("file");
    let buffer: Buffer | null = null;
    let ext = "bin";
    if (file instanceof File) {
      buffer = Buffer.from(await file.arrayBuffer());
      const name = file.name || "";
      ext = name.includes(".") ? name.split(".").pop()! : (file.type.split("/")[1] || "bin");
    }

    const invoice = saveInvoice(payload, buffer, ext);
    return NextResponse.json({ ok: true, invoice });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Save failed." }, { status: 500 });
  }
}
