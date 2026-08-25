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
    // O cron que impede a passagem de adormecer. Sem isto o `RELAY_ONLY`
    // devolveria 404 ao proprio cron, e o remedio nunca chegaria ao doente.
    pathname === "/api/phone/keepalive" ||
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

/**
 * Escrita permitida mesmo com a licença vencida.
 *
 * Entrar, sair, recuperar senha — e ATIVAR uma licença nova, que é a porta de
 * saída. Trancar a própria ativação faria um vencimento ser irreversível sem
 * mexer no banco à mão.
 */
function escritaSempreLiberada(pathname: string): boolean {
  return (
    pathname.startsWith("/api/auth/") ||
    /^\/api\/companies\/[^/]+\/activate$/.test(pathname)
  );
}

const HOJE = () => new Date().toISOString().slice(0, 10);

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

  /**
   * `LICENSE_CONSOLE=1` na implantação do CONSOLE DE LICENÇAS.
   *
   * Mesma ideia do `RELAY_ONLY`, e pela mesma razão: uma implantação que serve
   * uma coisa só não pode servir o resto por acidente de configuração. Aqui a
   * implantação publica o console e mais nada — nem login, nem API, nem ERP.
   *
   * O console não pede sessão porque não tem o que proteger: a chave privada
   * vive no navegador de quem emite, cifrada com senha, e a assinatura
   * acontece lá. Sem a chave, esta página é um formulário que não faz nada.
   *
   * E o inverso importa igualmente: numa instalação de CLIENTE a variável não
   * está definida, então `/console` responde 404. A ferramenta de quem vende
   * não fica pendurada, mesmo que inerte, dentro do produto do cliente.
   */
  const ehConsole = pathname === "/console" || pathname.startsWith("/console/");
  if (process.env.LICENSE_CONSOLE) {
    if (ehConsole || pathname.startsWith("/_next") || pathname === "/favicon.ico"
        || pathname === "/logo.png" || pathname === "/icon.png") {
      return NextResponse.next();
    }
    return new NextResponse("Not found", { status: 404 });
  }
  if (ehConsole) {
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
      const { payload } = await jwtVerify(token, secret());

      /*
       * A TRAVA DA LICENÇA.
       *
       * Fica aqui, e não em cada rota, por uma razão prática: o middleware vê
       * TODOS os pedidos, inclusive os das rotas que alguém escrever no mês
       * que vem e esquecer de proteger. Uma trava que depende de ninguém
       * esquecer não é uma trava.
       *
       * Vencida, o sistema fica em modo LEITURA: `GET` e `HEAD` passam — as
       * telas abrem, os relatórios saem em PDF e Excel —, e tudo que grava é
       * recusado com 402. É a decisão do Alfredo em 2026-08-24: cobra sem
       * prender o escritório fora dos próprios livros.
       *
       * O `master` não é travado: é ele quem renova, e travá-lo trancaria a
       * pessoa que resolve o problema para fora da tela que o resolve.
       */
      const validade = payload.lic as string | null | undefined;
      const escreve = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      const vencida = Boolean(validade && validade < HOJE());

      if (vencida && escreve && payload.role !== "master" && !escritaSempreLiberada(pathname)) {
        return NextResponse.json(
          {
            error: "licenseExpired",
            messageKey: "license.blockedWrite",
            expiresAt: validade,
          },
          { status: 402 }
        );
      }

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
