import { NextRequest, NextResponse } from "next/server";
import { listClients, createClient, clientsWithStats } from "@/lib/store";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || undefined;
  // Every list is scoped to the signed-in user's company.
  const company = (await getSessionUser())?.company_id ?? null;
  if (searchParams.get("stats") === "1") {
    return NextResponse.json({ clients: await clientsWithStats(q, company) });
  }
  return NextResponse.json({ clients: await listClients(q, company) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.name?.trim()) {
      return NextResponse.json({ error: "Client name is required." }, { status: 400 });
    }
    // New clients belong to the creator's company, never to whatever the
    // request body claims.
    const company = (await getSessionUser())?.company_id ?? null;
    const client = await createClient({ ...body, company_id: company });
    return NextResponse.json({ client });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Create failed." }, { status: 500 });
  }
}
