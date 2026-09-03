"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { licenseStatus, daysUntil, needsAlert } from "@/lib/license";
import { useSession } from "@/components/PermissionScope";
import type { Company } from "@/lib/types";

const DISMISS_KEY = "vat-license-banner-dismissed";

/**
 * Proactive licence-expiry alert (≤30 days or already expired/inactive).
 * Tenant users see their own company; master sees a rollup across every
 * company, since master's own session company is not necessarily the one
 * running low.
 */
export default function LicenseAlertBanner() {
  const { t } = useT();
  const [msg, setMsg] = useState<{ text: string; danger: boolean; href?: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  /*
   * A sessão vem do contexto, e não de um `fetch` próprio.
   *
   * Este aviso monta em toda tela e só olha a licença: buscar `/api/auth/me`
   * de novo para descobrir quem é o utilizador repetia, a cada navegação, um
   * pedido já feito pelo `PermissionProvider`.
   */
  const me = useSession();

  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    if (!me.ready) return;
    (async () => {
      if (!me.user) return;

      if (me.user.role === "master") {
        const compRes = await fetch("/api/companies", { cache: "no-store" });
        if (!compRes.ok) return;
        const { companies } = (await compRes.json()) as { companies: Company[] };
        const flagged = (companies || []).filter((c) =>
          needsAlert(licenseStatus(c.license_expires_at, c.active))
        );
        if (flagged.length) {
          setMsg({
            text: t("master.expiringBannerCount", { count: flagged.length }),
            danger: flagged.some((c) => licenseStatus(c.license_expires_at, c.active) !== "expiring"),
            href: "/master",
          });
        }
        return;
      }

      if (!me.company) return;
      const state = licenseStatus(me.company.license_expires_at, me.company.active);
      if (!needsAlert(state)) return;
      if (state === "inactive") {
        setMsg({ text: t("license.inactiveBanner"), danger: true });
      } else if (state === "expired") {
        setMsg({ text: t("license.expiredBanner"), danger: true, href: "/settings#license" });
      } else if (me.company.license_expires_at) {
        setMsg({
          text: t("license.expiringBanner", {
            days: daysUntil(me.company.license_expires_at),
            date: me.company.license_expires_at,
          }),
          danger: false,
          href: "/settings#license",
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.ready, me.user, me.company]);

  if (!msg || dismissed) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div
      className={`flex items-center gap-3 border-b px-5 py-2.5 text-sm ${
        msg.danger
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-warning/30 bg-warning/10 text-warning"
      }`}
    >
      <span className="flex-1">
        {msg.href ? (
          <Link href={msg.href} className="underline underline-offset-2">
            {msg.text}
          </Link>
        ) : (
          msg.text
        )}
      </span>
      <button onClick={dismiss} className="shrink-0 text-xs underline underline-offset-2 opacity-80 hover:opacity-100">
        {t("common.dismiss")}
      </button>
    </div>
  );
}
