import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase, hasSupabaseConfig } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";

// Upsert a VAT category (accountant maintenance). Requires Supabase.
export async function PUT(req: NextRequest) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "Editing requires Supabase. Configure .env.local and apply db/schema.sql." },
      { status: 400 }
    );
  }
  try {
    const body = await req.json();
    const row = {
      code: body.code ?? null,
      description: String(body.description || "").trim(),
      keywords: Array.isArray(body.keywords) ? body.keywords : [],
      vat_rate: Number(body.vat_rate),
      rate_type: body.rate_type,
      effective_from: body.effective_from || "2000-01-01",
      effective_to: body.effective_to || null,
      active: body.active !== false,
      updated_by: body.updated_by || "app",
    };
    if (!row.description || Number.isNaN(row.vat_rate)) {
      return NextResponse.json({ error: "description and vat_rate are required." }, { status: 400 });
    }
    const sb = getServerSupabase();
    const query = body.id
      ? sb.from("vat_categories").update(row).eq("id", body.id).select().single()
      : sb.from("vat_categories").insert(row).select().single();
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ category: data });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Save failed." }, { status: 500 });
  }
}

// Deactivate a category (soft delete).
export async function DELETE(req: NextRequest) {
  // Destructive: administrators only. The UI hides these buttons, but the
  // check has to live here to actually be a permission.
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  if (!hasSupabaseConfig()) {
    return NextResponse.json({ error: "Editing requires Supabase." }, { status: 400 });
  }
  try {
    const { id } = await req.json();
    const sb = getServerSupabase();
    const { error } = await sb.from("vat_categories").update({ active: false }).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Delete failed." }, { status: 500 });
  }
}
