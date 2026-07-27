import { NextRequest, NextResponse } from "next/server";
import { listAccounts, createAccount, bulkImportAccounts } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ accounts: await listAccounts(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  if (Array.isArray(body?.rows)) {
    const count = await bulkImportAccounts(params.id, body.rows);
    return NextResponse.json({ imported: count });
  }
  const account = await createAccount(params.id, body || {});
  if (!account) return NextResponse.json({ error: "Code is required." }, { status: 400 });
  return NextResponse.json({ account });
}
