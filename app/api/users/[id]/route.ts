import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireRole } from "@/lib/auth";
import { updateAppUser, deleteAppUser } from "@/lib/store";
import { sanitizePermIds } from "@/lib/permissions";

export const runtime = "nodejs";

const safe = (u: any) => ({
  id: u.id, email: u.email, name: u.name, role: u.role,
  active: u.active, created_at: u.created_at, screen_access: u.screen_access ?? null,
});

/** Ver a gêmea em app/api/users/route.ts para por que lista vazia vira `null`. */
function parseScreenAccess(body: any): string[] | null | undefined {
  if (!("screen_access" in body)) return undefined;
  if (body.screen_access === null) return null;
  if (!Array.isArray(body.screen_access)) return undefined;
  const ids = sanitizePermIds(body.screen_access);
  return ids.length ? ids : null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const body = await req.json();
  const patch: any = {};

  if ("name" in body) patch.name = body.name ? String(body.name) : null;
  if ("active" in body) patch.active = !!body.active;
  const screenAccess = parseScreenAccess(body);
  if (screenAccess !== undefined) patch.screen_access = screenAccess;

  if ("role" in body) {
    const role = ["user", "admin", "master"].includes(body.role) ? body.role : null;
    if (!role) return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    if (role === "master" && guard.user.role !== "master") {
      return NextResponse.json({ error: "Only a master can grant master rights." }, { status: 403 });
    }
    // Guard against locking yourself out of user administration.
    if (params.id === guard.user.id && role === "user") {
      return NextResponse.json(
        { error: "You cannot remove your own administrator rights." },
        { status: 400 }
      );
    }
    patch.role = role;
  }

  if (params.id === guard.user.id && patch.active === false) {
    return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 });
  }

  if (body?.password) {
    const pw = String(body.password);
    if (pw.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    patch.password_hash = await bcrypt.hash(pw, 10);
  }

  const user = await updateAppUser(params.id, patch);
  if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ user: safe(user) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  if (params.id === guard.user.id) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }
  return NextResponse.json({ ok: await deleteAppUser(params.id) });
}
