"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getCurrentClient, type CurrentClient } from "@/lib/currentClient";
import { useT } from "@/lib/i18n";

const NAV = [
  { href: "/", key: "nav.dashboard", icon: IconGrid },
  { href: "/clients", key: "nav.clients", icon: IconUsers },
  { href: "/analyze", key: "nav.analyze", icon: IconScan },
  { href: "/records", key: "nav.database", icon: IconStack },
  { href: "/items", key: "nav.items", icon: IconTag },
  { href: "/base", key: "nav.rateBase", icon: IconPercent },
  { href: "/settings", key: "nav.settings", icon: IconCog },
] as const;

const COLLAPSE_KEY = "vat-sidebar-collapsed";

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useT();
  const [client, setClient] = useState<CurrentClient>(null);
  const [isMaster, setIsMaster] = useState(false);
  // Undefined until read from storage, so the first paint doesn't flash the
  // wrong width.
  const [collapsed, setCollapsed] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const read = () => setClient(getCurrentClient());
    read();
    window.addEventListener("current-client-changed", read);
    return () => window.removeEventListener("current-client-changed", read);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json())
      .then((d) => setIsMaster(d.user?.role === "master")).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      setCollapsed(false);
    }
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* private mode — the choice just won't persist */
    }
  }

  // `open` drives the labels; while the preference is still unknown we keep
  // the responsive default (hidden under lg) to avoid a layout jump.
  const open = collapsed === false;
  const showLabel = open ? "block" : collapsed === undefined ? "hidden lg:block" : "hidden";

  return (
    <aside
      className={`sticky top-0 flex h-dvh shrink-0 flex-col bg-night px-3 py-5 transition-[width] duration-200 ${
        collapsed === undefined ? "w-[68px] lg:w-64" : open ? "w-64" : "w-[68px]"
      }`}
    >
      {/* Brand */}
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-1" title="VAT Reader">
        <img src="/logo.png" alt="VAT Reader" className="h-9 w-9 shrink-0 rounded-xl shadow-brand" />
        <span className={showLabel}>
          <span className="block font-display text-lg font-semibold leading-none text-white">
            VAT Reader
          </span>
          <span className="block text-[11px] font-medium tracking-wide text-night-muted">
            Ireland · ERP
          </span>
        </span>
      </Link>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          const label = t(n.key);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`nav-item ${active ? "nav-item-active" : ""}`}
              title={label}
            >
              <Icon />
              <span className={showLabel}>{label}</span>
            </Link>
          );
        })}
        {isMaster && (
          <Link
            href="/master"
            className={`nav-item ${pathname.startsWith("/master") ? "nav-item-active" : ""}`}
            title={t("master.title")}
          >
            <IconShield />
            <span className={showLabel}>{t("master.title")}</span>
          </Link>
        )}
      </nav>

      {/* Client card → selected client's home; small switch link */}
      <div className="mt-4 rounded-xl bg-night-2 px-3 py-3">
        <Link
          href={client ? `/clients/${client.id}` : "/clients"}
          className="flex items-center gap-3 text-left"
          title={client ? `Open ${client.name}` : "Select a client"}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-semibold text-white">
            {client ? initials(client.name) : "—"}
          </span>
          <span className={`min-w-0 ${showLabel}`}>
            <span className="block truncate text-sm font-medium text-white">
              {client ? client.name : t("nav.noClient")}
            </span>
            <span className="block text-[11px] text-brand-400">{t("nav.openClient")}</span>
          </span>
        </Link>
        <Link
          href="/clients"
          className={`mt-2 text-[11px] text-night-muted transition-colors hover:text-white ${showLabel}`}
        >
          {t("nav.switchCompany")}
        </Link>
      </div>

      {/* Collapse / pin */}
      <button
        onClick={toggle}
        className="mt-2 flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-night-muted transition-colors hover:bg-white/5 hover:text-white"
        title={open ? t("nav.collapse") : t("nav.expand")}
        aria-label={open ? t("nav.collapse") : t("nav.expand")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" {...S} />
          <path d="M9 4v16" {...S} />
          {open ? <path d="M15.5 9.5 13 12l2.5 2.5" {...S} /> : <path d="M13 9.5 15.5 12 13 14.5" {...S} />}
        </svg>
        <span className={showLabel}>{t("nav.collapse")}</span>
      </button>

      <button
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.href = "/login";
        }}
        className="flex items-center gap-3 rounded-xl px-3 h-10 text-sm font-medium text-night-muted transition-colors hover:bg-white/5 hover:text-white"
        title={t("nav.signOut")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
          <path d="M15 12H4m0 0l4-4m-4 4l4 4M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" {...S} />
        </svg>
        <span className={showLabel}>{t("nav.signOut")}</span>
      </button>
    </aside>
  );
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
}

/* ---- icons (stroke 1.8) ---- */
function base(children: React.ReactNode) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
      {children}
    </svg>
  );
}
const S = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function IconGrid() { return base(<><rect x="3" y="3" width="7" height="7" rx="1.5" {...S} /><rect x="14" y="3" width="7" height="7" rx="1.5" {...S} /><rect x="3" y="14" width="7" height="7" rx="1.5" {...S} /><rect x="14" y="14" width="7" height="7" rx="1.5" {...S} /></>); }
function IconUsers() { return base(<><circle cx="9" cy="8" r="3.2" {...S} /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" {...S} /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 20a5.5 5.5 0 0 0-2-4.3" {...S} /></>); }
function IconScan() { return base(<><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" {...S} /><path d="M7 12h10" {...S} /></>); }
function IconStack() { return base(<><path d="M12 3l9 5-9 5-9-5 9-5Z" {...S} /><path d="M3 12l9 5 9-5M3 16l9 5 9-5" {...S} /></>); }
function IconTag() { return base(<><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" {...S} /><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none" /></>); }
function IconShield() { return base(<><path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 8.9-4.1-1-7-4.7-7-8.9V6l7-3Z" {...S} /><path d="m9.5 12 1.8 1.8 3.4-3.6" {...S} /></>); }
function IconCog() { return base(<><circle cx="12" cy="12" r="3.2" {...S} /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z" {...S} /></>); }
function IconPercent() { return base(<><path d="M19 5 5 19" {...S} /><circle cx="7.5" cy="7.5" r="2.5" {...S} /><circle cx="16.5" cy="16.5" r="2.5" {...S} /></>); }
