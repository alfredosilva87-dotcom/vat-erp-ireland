import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { updateCompany, generateLicenseKey } from "@/lib/store";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole("master");
  if ("error" in guard) return guard.error;

  const body = await req.json();
  const patch: any = {};

  if ("name" in body) patch.name = String(body.name).trim();
  if ("active" in body) patch.active = !!body.active;
  if ("contact_email" in body) patch.contact_email = body.contact_email || null;
  if ("notes" in body) patch.notes = body.notes || null;
  if ("license_expires_at" in body) patch.license_expires_at = body.license_expires_at || null;

  // "renew" extends from today, so renewing an expired licence starts a fresh
  // term instead of adding to a date already in the past.
  if (body?.renewMonths) {
    const d = new Date();
    d.setMonth(d.getMonth() + Number(body.renewMonths));
    patch.license_expires_at = d.toISOString().slice(0, 10);
  }
  if (body?.regenerateKey) patch.license_key = generateLicenseKey();

  // Guard against a master switching off the company they are signed into.
  if (patch.active === false && params.id === guard.user.company_id) {
    return NextResponse.json(
      { error: "You cannot deactivate the company you are signed into." },
      { status: 400 }
    );
  }

  const company = await updateCompany(params.id, patch);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ company });
}
