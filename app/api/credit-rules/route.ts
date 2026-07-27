import { NextRequest, NextResponse } from "next/server";
import { listCreditRules, createCreditRule } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ rules: await listCreditRules() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const rule = await createCreditRule(body);
  return NextResponse.json({ rule });
}
