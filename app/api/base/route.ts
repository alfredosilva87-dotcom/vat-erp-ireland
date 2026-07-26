import { NextResponse } from "next/server";
import { loadBase } from "@/lib/loadBase";

export const runtime = "nodejs";

// GET the current rate base + credit rules (live from Supabase, or bundled).
export async function GET() {
  const { categories, rules, source } = await loadBase();
  return NextResponse.json({ categories, rules, source });
}
