import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listLicenseEvents } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireRole("master");
  if ("error" in guard) return guard.error;
  return NextResponse.json({ events: await listLicenseEvents(params.id) });
}
