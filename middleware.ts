import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "vat_session";
function secret() {
  return new TextEncoder().encode(process.env.AUTH_SECRET || "dev-insecure-secret-change-me");
}

/**
 * Caminhos que a implantação da PASSAGEM serve — E que qualquer implantação
 * libera sem sessão, porque são a mesma coisa: tudo que a captura por telefone
 * precisa (camada B4) tem que funcionar tanto na passagem quanto no servidor do
 * escritório, sem login.
 *
 * Uma lista só, usada nos dois lugares abaixo. Antes eram duas listas quase
 * iguais e diferentes por um esquecimento: a rota do manifesto por link entrou
 * na trava `RELAY_ONLY` mas não na liberação de sessão, e a implantação real na
 * Vercel teria devolvido o LOGIN em vez do manifesto — silencioso, porque o
 * navegador só ignora um manifesto que falhou ao carregar. Uma lista não deixa
 * a próxima rota nova esquecer a segunda cópia.
 */
function isPublicCapturePath(pathname: string): boolean {
  return (
    pathname.startsWith("/enviar/") ||
    pathname === "/api/phone/upload" ||
    pathname.startsWith("/api/phone/manifest/") ||
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
  if (process.env.RELAY_ONLY && !isPublicCapturePath(pathname)) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (
    pathname === "/login" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/api/auth") ||
    // Captura por telefone (camada B4) e os ícones/manifesto, que precisam ser
    // alcançáveis sem sessão — a página de login mostra o logo, e o navegador
    // busca o manifesto para decidir se o app é instalável antes de qualquer
    // login existir. Ver lib/phoneIntake.ts para por que a captura não tem senha.
    isPublicCapturePath(pathname)
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
