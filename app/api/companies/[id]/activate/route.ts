import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { activateLicense } from "@/lib/store";

export const runtime = "nodejs";

// Company admin self-service: activates a renewal key master handed them out
// of band. Deliberately scoped to the caller's own company — an admin can
// never activate a licence for a company they don't belong to.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;
  if (guard.user.company_id !== params.id) {
    return NextResponse.json({ error: "Not your company." }, { status: 403 });
  }

  const body = await req.json();
  const key = String(body?.key || "").trim();
  if (!key) return NextResponse.json({ error: "Enter the activation key." }, { status: 400 });

  const result = await activateLicense(params.id, key, guard.user.email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, expiresAt: result.expiresAt });
}
