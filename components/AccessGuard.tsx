"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePermissions } from "@/components/PermissionScope";
import { permForPath, grantsScreen } from "@/lib/permissions";
import { useT } from "@/lib/i18n";

/**
 * A trava que faz a árvore de permissões valer também para quem digita a URL.
 *
 * Sem isto a permissão seria só um menu mais curto: some o item, mas o endereço
 * continua abrindo — e um endereço de tela circula por e-mail e por link colado
 * o tempo todo dentro de um escritório.
 *
 * O alcance é honesto: isto é a NAVEGAÇÃO. A tela não abre, mas a rota de API
 * por trás dela ainda responde a qualquer sessão válida da mesma empresa. Quem
 * separa empresa de empresa é lib/access.ts, no servidor, em toda rota. Fechar
 * a API por tela também é a camada seguinte, e ela não existe ainda.
 */
export default function AccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, isMaster, screenAccess } = usePermissions();
  const { t } = useT();

  const id = permForPath(pathname);
  const blocked = ready && !isMaster && id !== null && !grantsScreen(screenAccess, id);
  if (!blocked) return <>{children}</>;

  return (
    <div className="card rise mx-auto max-w-lg p-8 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <h1 className="mt-4 font-display text-xl font-semibold">{t("perm.blockedTitle")}</h1>
      <p className="mt-1 text-sm text-muted">{t("perm.blockedBody")}</p>
      <Link href="/" className="btn-ghost mt-5 inline-flex">{t("nav.dashboard")}</Link>
    </div>
  );
}
