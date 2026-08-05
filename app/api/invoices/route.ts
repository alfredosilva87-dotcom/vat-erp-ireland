import { NextRequest, NextResponse } from "next/server";
import { saveInvoice, listInvoices, listMasterItems, stats } from "@/lib/store";
import type { SavePayload } from "@/lib/store";
import { findDuplicate } from "@/lib/duplicates";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || undefined;
  const clientId = searchParams.get("client") || undefined;
  const branchId = searchParams.get("branch") || undefined;
  const start = searchParams.get("start") || undefined;
  const end = searchParams.get("end") || undefined;
  const needsReview = searchParams.get("review") === "1";
  const idsParam = searchParams.get("ids");
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : undefined;
  const view = searchParams.get("view"); // "items" for de-para master
  if (view === "items") {
    return NextResponse.json({ items: await listMasterItems(q), stats: await stats(clientId) });
  }
  return NextResponse.json({
    invoices: await listInvoices({ q, clientId, branchId, start, end, needsReview, ids }),
    stats: await stats(clientId),
  });
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

    const force = form.get("force") === "true";
    if (!force) {
      const existing = await findDuplicate(payload.client_id, {
        supplier_name: payload.header.supplier_name,
        invoice_number: payload.header.invoice_number,
        barcode: payload.header.barcode,
        invoice_date: payload.header.invoice_date,
        total_gross: payload.header.total_gross,
      });
      if (existing) {
        return NextResponse.json({ error: "duplicate", existing }, { status: 409 });
      }
    }

    const invoice = await saveInvoice(payload, buffer, ext);
    return NextResponse.json({ ok: true, invoice });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Save failed." }, { status: 500 });
  }
}
