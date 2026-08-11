"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import LicenseAlertBanner from "@/components/LicenseAlertBanner";
import { useT } from "@/lib/i18n";

const PUBLIC_PATHS = ["/login", "/reset-password"];

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useT();
  if (PUBLIC_PATHS.includes(pathname)) return <>{children}</>;

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <LicenseAlertBanner />
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-7">{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-5 py-6 text-xs text-muted">
{t("app.footer")}
        </footer>
      </div>
    </div>
  );
}
