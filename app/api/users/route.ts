import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireRole } from "@/lib/auth";
import { listAppUsers, createAppUser, findAppUserByEmail } from "@/lib/store";

export const runtime = "nodejs";

/** Never leak password hashes to the client. */
const safe = (u: any) => ({
  id: u.id, email: u.email, name: u.name, role: u.role,
  active: u.active, created_at: u.created_at,
});

export async function GET() {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;
  return NextResponse.json({ users: (await listAppUsers(guard.user.company_id)).map(safe) });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const body = await req.json();
  const email = String(body?.email || "").toLowerCase().trim();
  const password = String(body?.password || "");
  const role = ["user", "admin", "master"].includes(body?.role) ? body.role : "user";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (await findAppUserByEmail(email)) {
    return NextResponse.json({ error: "That email is already registered." }, { status: 409 });
  }
  // Only a master can mint another master.
  if (role === "master" && guard.user.role !== "master") {
    return NextResponse.json({ error: "Only a master can create a master account." }, { status: 403 });
  }

  const user = await createAppUser({
    email,
    name: body?.name ? String(body.name) : null,
    password_hash: await bcrypt.hash(password, 10),
    role,
    company_id: guard.user.company_id,
  });
  return NextResponse.json({ user: safe(user) });
}
