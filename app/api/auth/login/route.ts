import { NextRequest, NextResponse } from "next/server";
import { verifyCredentials, createSession } from "@/lib/auth";

export const runtime = "nodejs";

// Failure reasons map to i18n keys so the login screen can explain itself in
// the user's language.
const MESSAGE: Record<string, { key: string; status: number }> = {
  invalid: { key: "login.invalid", status: 401 },
  companyInactive: { key: "login.companyInactive", status: 403 },
  licenseExpired: { key: "login.licenseExpired", status: 403 },
};

export async function POST(req: NextRequest) {
  try {
    const { email, password, company, remember } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const result = await verifyCredentials(
      String(email),
      String(password),
      company ? String(company).trim() : undefined
    );

    if ("failure" in result) {
      const m = MESSAGE[result.failure] ?? MESSAGE.invalid;
      return NextResponse.json({ error: result.failure, messageKey: m.key }, { status: m.status });
    }

    // Só `false` explícito encurta a sessão — ver `createSession`.
    await createSession(result.user, remember !== false);
    return NextResponse.json({
      ok: true,
      user: {
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
        company: result.user.company_name,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Login failed." }, { status: 500 });
  }
}
