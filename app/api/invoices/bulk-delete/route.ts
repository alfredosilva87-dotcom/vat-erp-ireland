import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { deleteInvoices } from "@/lib/store";
import { filterInvoicesByCompany } from "@/lib/access";

export const runtime = "nodejs";
export const maxDuration = 60;

// Bulk delete is destructive: administrators only, same as the single-invoice
// DELETE. POST (not DELETE) because the id list travels in the body.
export async function POST(req: NextRequest) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => null);
  const asked = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  const scoped = await filterInvoicesByCompany(asked);
  if (!Array.isArray(scoped)) return scoped.error;
  const ids = scoped;
  if (!ids.length) {
    return NextResponse.json({ error: "No invoices selected." }, { status: 400 });
  }

  const deleted = await deleteInvoices(ids);
  return NextResponse.json({ deleted });
}
