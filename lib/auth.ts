import "server-only";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { hasSupabaseConfig, getServerSupabase } from "@/lib/supabase";
import { findAppUserByEmail } from "@/lib/store";
import type { AppUser, Company } from "@/lib/types";

export const SESSION_COOKIE = "vat_session";

export type SessionUser = {
  id: string; email: string; name: string | null; role: string;
  company_id: string | null; company_slug: string | null; company_name: string | null;
};

/** Why a sign-in was refused, so the UI can say something useful. */
export type LoginFailure = "invalid" | "companyInactive" | "licenseExpired";

function secret() {
  return new TextEncoder().encode(process.env.AUTH_SECRET || "dev-insecure-secret-change-me");
}

// Look up a user. Both branches read `app_users` from the same Supabase project;
// the second is not a local/offline store — it just goes through lib/store's
// client. So a deployment whose Supabase has no `app_users` (the phone-intake
// relay, layer B4) can never authenticate anyone: there is no seeded fallback
// admin behind this.
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

/**
 * Verifies credentials and the tenant's standing in one step: a correct
 * password is not enough if the company is switched off or the licence has
 * lapsed. `companySlug` is optional — users belonging to a single company do
 * not have to type it.
 */
export async function verifyCredentials(
  email: string,
  password: string,
  companySlug?: string
): Promise<{ user: SessionUser } | { failure: LoginFailure }> {
  const u = await lookup(email);
  if (!u) return { failure: "invalid" };
  if (!(await bcrypt.compare(password, u.password_hash))) return { failure: "invalid" };

  let company: Company | null = null;
  if (u.company_id && hasSupabaseConfig()) {
    const { data } = await getServerSupabase()
      .from("companies").select("*").eq("id", u.company_id).maybeSingle();
    company = (data as Company) ?? null;
  }

  // A slug typed at login must match the account, else it is a wrong sign-in.
  if (companySlug && company && company.slug.toLowerCase() !== companySlug.toLowerCase()) {
    return { failure: "invalid" };
  }

  if (company) {
    if (!company.active) return { failure: "companyInactive" };
    if (company.license_expires_at && company.license_expires_at < new Date().toISOString().slice(0, 10)) {
      // A master must still get in — otherwise an expired licence locks the
      // person who renews it out of the master panel.
      if (u.role !== "master") return { failure: "licenseExpired" };
    }
  }

  return {
    user: {
      id: u.id, email: u.email, name: u.name, role: u.role,
      company_id: u.company_id ?? null,
      company_slug: company?.slug ?? null,
      company_name: company?.name ?? null,
    },
  };
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({
    email: user.email, name: user.name, role: user.role,
    company_id: user.company_id, company_slug: user.company_slug, company_name: user.company_name,
  })
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
    return {
      id: String(payload.sub),
      email: String(payload.email),
      name: (payload.name as string) ?? null,
      role: String(payload.role),
      company_id: (payload.company_id as string) ?? null,
      company_slug: (payload.company_slug as string) ?? null,
      company_name: (payload.company_name as string) ?? null,
    };
  } catch {
    return null;
  }
}
