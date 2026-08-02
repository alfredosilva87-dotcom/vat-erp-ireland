import "server-only";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { hasSupabaseConfig, getServerSupabase } from "@/lib/supabase";
import { findAppUserByEmail } from "@/lib/store";
import type { AppUser } from "@/lib/types";

export const SESSION_COOKIE = "vat_session";

export type SessionUser = { id: string; email: string; name: string | null; role: string };

function secret() {
  return new TextEncoder().encode(process.env.AUTH_SECRET || "dev-insecure-secret-change-me");
}

// Look up a user in Supabase (when configured) else the local store.
async function lookup(email: string): Promise<AppUser | null> {
  const e = email.toLowerCase().trim();
  if (hasSupabaseConfig()) {
    try {
      const sb = getServerSupabase();
      const { data } = await sb.from("app_users").select("*").eq("email", e).eq("active", true).maybeSingle();
      if (data) return data as AppUser;
    } catch {
      /* fall through to local */
    }
  }
  return await findAppUserByEmail(e);
}

export async function verifyCredentials(email: string, password: string): Promise<SessionUser | null> {
  const u = await lookup(email);
  if (!u) return null;
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSession() {
  cookies().set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

// master > admin > user. Kept as a rank so checks read as "at least admin"
// rather than enumerating roles at every call site.
const RANK: Record<string, number> = { user: 1, admin: 2, master: 3 };
export type Role = "user" | "admin" | "master";

export function hasRole(user: SessionUser | null, min: Role): boolean {
  return !!user && (RANK[user.role] ?? 0) >= RANK[min];
}

/**
 * Guard for API routes. Returns the user when allowed, or a ready-to-return
 * 401/403 response. Hiding a button in the UI is not protection — destructive
 * endpoints must call this.
 */
export async function requireRole(
  min: Role
): Promise<{ user: SessionUser } | { error: Response }> {
  const user = await getSessionUser();
  if (!user) {
    return { error: Response.json({ error: "Not signed in." }, { status: 401 }) };
  }
  if (!hasRole(user, min)) {
    return {
      error: Response.json(
        { error: "You do not have permission to perform this action." },
        { status: 403 }
      ),
    };
  }
  return { user };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { id: String(payload.sub), email: String(payload.email), name: (payload.name as string) ?? null, role: String(payload.role) };
  } catch {
    return null;
  }
}
