import { NextRequest, NextResponse } from "next/server";
import { verifyCredentials, createSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }
    const user = await verifyCredentials(String(email), String(password));
    if (!user) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }
    await createSession(user);
    return NextResponse.json({ ok: true, user: { email: user.email, name: user.name, role: user.role } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Login failed." }, { status: 500 });
  }
}
