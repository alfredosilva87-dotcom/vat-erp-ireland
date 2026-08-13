import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "vat_session";
function secret() {
  return new TextEncoder().encode(process.env.AUTH_SECRET || "dev-insecure-secret-change-me");
}

/**
 * Caminhos que a implantação da PASSAGEM serve. Nada além disto.
 *
 * Ver `RELAY_ONLY` abaixo.
 */
function isRelayPath(pathname: string): boolean {
  return (
    pathname.startsWith("/enviar/") ||
    pathname === "/api/phone/upload" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon.png" ||
    pathname === "/apple-icon.png" ||
    pathname === "/logo.png" ||
    pathname === "/icon-192.png" ||
    pathname === "/icon-512.png"
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  /**
   * `RELAY_ONLY=1` na implantação da passagem (camada B4).
   *
   * A passagem roda o MESMO código do ERP, então sem isto ela publica na
   * internet a tela de login do sistema contábil. Hoje ninguém entra porque
   * aquela implantação aponta para o banco da passagem, que não tem `app_users`
   * — mas essa segurança depende de as variáveis de ambiente estarem certas para
   * sempre. No dia em que alguém colar ali a chave do escritório por engano, o
   * ERP inteiro fica exposto, e nada avisaria.
   *
   * Com a trava, a exposição deixa de depender de configuração: a implantação
   * **não tem** as outras rotas. 404 e não redirecionar para o login, porque na
   * passagem não existe login para onde ir.
   */
  if (process.env.RELAY_ONLY && !isRelayPath(pathname)) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (
    pathname === "/login" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    // Captura por telefone (camada B4). Pública por desenho: quem abre é cliente
    // do escritório e não tem sessão — o token do link é a credencial, e ele só
    // escreve. Ver lib/phoneIntake.ts para por que não há senha aqui.
    pathname.startsWith("/enviar/") ||
    pathname === "/api/phone/upload" ||
    pathname === "/favicon.ico" ||
    // Icons/manifest have to be reachable while logged out — the login page
    // itself shows the logo, and browsers fetch the manifest to decide
    // whether the app is installable before there's any session at all.
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon.png" ||
    pathname === "/apple-icon.png" ||
    pathname === "/logo.png" ||
    pathname === "/icon-192.png" ||
    pathname === "/icon-512.png"
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
