import { NextRequest, NextResponse } from "next/server";
import { listMasterItems } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get("q") || undefined;
  return NextResponse.json({ items: listMasterItems(q) });
}
