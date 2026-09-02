"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import ModuleSidebar from "@/components/ModuleSidebar";
import LicenseGate from "@/components/LicenseGate";
import UpdateBanner from "@/components/UpdateBanner";
import TopBar from "@/components/TopBar";
import { ClientScopeProvider, useClientScope } from "@/components/ClientScope";
import { PermissionProvider } from "@/components/PermissionScope";
import AccessGuard from "@/components/AccessGuard";
import { useT } from "@/lib/i18n";
import { MobileNavProvider, MobileNavBackdrop } from "@/components/MobileNav";

const PUBLIC_PATHS = ["/login", "/reset-password"];
// Prefixos sem sessão. `/enviar/<token>` é a captura por telefone (camada B4):
// quem abre é cliente do escritório, não usuário — barra lateral, alerta de
// licença e menu não fazem sentido ali, e o token é dinâmico, então a
// comparação exata de PUBLIC_PATHS não serve.
// `/console` é a ferramenta de quem VENDE, não do produto: sem menu, sem
// alerta de licença, sem sessão. Ver app/console/page.tsx.
const PUBLIC_PREFIXES = ["/enviar/", "/console"];

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (PUBLIC_PATHS.includes(pathname)) return <>{children}</>;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return <>{children}</>;

  // Dentro do workspace de um cliente o menu vira o menu do módulo — troca
  // completa, não uma segunda coluna. `/clients` (a lista) continua com o
  // menu geral; só `/clients/<id>/...` entra no modo módulo.
  //
  // Só o CAMINHO é lido aqui, de propósito: `useSearchParams()` num layout
  // raiz obriga toda rota do app a ter fronteira de Suspense, senão o build
  // quebra. Telas de cliente fora de `/clients/` (a revisão de uma nota) dizem
  // em que cliente estão pelo ClientScope — ver components/ClientScope.tsx.
  const direct = pathname.match(/^\/clients\/([^/]+)/);
  const fromUrl = direct ? direct[1] : null;

  return (
    <PermissionProvider>
      <ClientScopeProvider fromUrl={fromUrl}>
        <Frame>{children}</Frame>
      </ClientScopeProvider>
    </PermissionProvider>
  );
}

/**
 * Separado do AppFrame porque precisa LER o contexto que o AppFrame fornece —
 * um componente não enxerga o provider que ele mesmo renderiza.
 */
function Frame({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  const { clientId } = useClientScope();

  return (
    <MobileNavProvider>
      {/*
        `overflow-x-clip` porque a gaveta fechada vive em `-translate-x-full`:
        sem isto ela fica fora do ecrã à esquerda e o telefone ganha um rolar
        lateral para o nada.
      */}
      <div className="flex min-h-dvh overflow-x-clip">
        {clientId ? <ModuleSidebar clientId={clientId} /> : <Sidebar />}
        <MobileNavBackdrop />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <UpdateBanner />
          <LicenseGate />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-5 sm:py-7">
            <AccessGuard>{children}</AccessGuard>
          </main>
          <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-muted sm:px-5">
{t("app.footer")}
          </footer>
        </div>
      </div>
    </MobileNavProvider>
  );
}
