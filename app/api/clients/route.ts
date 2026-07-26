import { NextRequest, NextResponse } from "next/server";
import { listClients, createClient, clientsWithStats } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || undefined;
  if (searchParams.get("stats") === "1") {
    return NextResponse.json({ clients: clientsWithStats(q) });
  }
  return NextResponse.json({ clients: listClients(q) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.name?.trim()) {
      return NextResponse.json({ error: "Client name is required." }, { status: 400 });
    }
    const client = createClient(body);
    return NextResponse.json({ client });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Create failed." }, { status: 500 });
  }
}
