import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { findAppUserByEmail } from "@/lib/store";
import { getServerSupabase, hasSupabaseConfig } from "@/lib/supabase";

export const runtime = "nodejs";

// Always the same generic response, whether or not the email is registered —
// this endpoint must not let an attacker enumerate which emails have
// accounts on a financial app.
const GENERIC_OK = NextResponse.json({ ok: true });

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") return GENERIC_OK;
    if (!hasSupabaseConfig()) return GENERIC_OK;

    const user = await findAppUserByEmail(email);
    if (!user) return GENERIC_OK;

    const sb = getServerSupabase();

    // Mirror into Supabase Auth on demand — app_users stays the source of
    // truth for login; this is only so Supabase's own mailer can send a
    // recovery link. Ignore "already registered", which is the expected
    // outcome on every request after the first for this user.
    await sb.auth.admin
      .createUser({ email: user.email, password: randomBytes(24).toString("hex"), email_confirm: true })
      .catch(() => {});

    await sb.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${req.nextUrl.origin}/reset-password`,
    });
  } catch (e) {
    // Never leak details — same generic response either way.
    console.error("forgot-password:", e);
  }
  return GENERIC_OK;
}
