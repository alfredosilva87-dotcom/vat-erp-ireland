import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "vat_session";
function secret() {
  return new TextEncoder().encode(process.env.AUTH_SECRET || "dev-insecure-secret-change-me");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname === "/login" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await jwtVerify(token, secret());
      return NextResponse.next();
    } catch {
      /* invalid/expired -> redirect */
    }
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
