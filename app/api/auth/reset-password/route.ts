import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { findAppUserByEmail, updateAppUser } from "@/lib/store";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

// The access_token is what proves this request really came from someone who
// clicked the genuine Supabase recovery email for a given address — we never
// trust a client-supplied email on its own.
export async function POST(req: NextRequest) {
  try {
    const { access_token, new_password } = await req.json();
    if (!access_token || !new_password || String(new_password).length < 8) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const { data, error } = await getServerSupabase().auth.getUser(String(access_token));
    if (error || !data?.user?.email) {
      return NextResponse.json({ error: "Link is invalid or has expired." }, { status: 401 });
    }

    const user = await findAppUserByEmail(data.user.email);
    if (!user) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const password_hash = await bcrypt.hash(String(new_password), 10);
    await updateAppUser(user.id, { password_hash });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Reset failed." }, { status: 500 });
  }
}
