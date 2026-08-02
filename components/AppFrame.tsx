"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import ThemeToggle from "@/components/ThemeToggle";
import { useT } from "@/lib/i18n";

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useT();
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-5">
            <Link
              href="/records"
              className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm text-muted shadow-raised"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              {t("nav.search")}
            </Link>
            <ThemeToggle />
            <Link href="/analyze" className="btn-primary hidden sm:inline-flex">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {t("nav.newAnalysis")}
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-5 py-6 text-xs text-muted">
{t("app.footer")}
        </footer>
      </div>
    </div>
  );
}
