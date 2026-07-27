"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getCurrentClient, type CurrentClient } from "@/lib/currentClient";

const NAV = [
  { href: "/", label: "Dashboard", icon: IconGrid },
  { href: "/clients", label: "Clients", icon: IconUsers },
  { href: "/analyze", label: "Analyze", icon: IconScan },
  { href: "/records", label: "Database", icon: IconStack },
  { href: "/items", label: "Items", icon: IconTag },
  { href: "/base", label: "Rate base", icon: IconPercent },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [client, setClient] = useState<CurrentClient>(null);

  useEffect(() => {
    const read = () => setClient(getCurrentClient());
    read();
    window.addEventListener("current-client-changed", read);
    return () => window.removeEventListener("current-client-changed", read);
  }, []);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="sticky top-0 flex h-dvh w-[68px] shrink-0 flex-col bg-night px-3 py-5 lg:w-64">
      {/* Brand */}
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-1">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-b from-brand-400 to-brand-700 font-display text-lg leading-none text-white shadow-brand">
          V
        </span>
        <span className="hidden lg:block">
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
          const active = isActive(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`nav-item ${active ? "nav-item-active" : ""}`}
              title={n.label}
            >
              <Icon />
              <span className="hidden lg:block">{n.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Client switcher */}
      <Link
        href="/clients"
        className="mt-4 flex items-center gap-3 rounded-xl bg-night-2 px-3 py-3 text-left transition-colors hover:bg-white/10"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-semibold text-white">
          {client ? initials(client.name) : "—"}
        </span>
        <span className="hidden min-w-0 lg:block">
          <span className="block truncate text-sm font-medium text-white">
            {client ? client.name : "No client selected"}
          </span>
          <span className="block text-[11px] text-night-muted">Switch company ⇄</span>
        </span>
      </Link>

      <button
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.href = "/login";
        }}
        className="mt-2 flex items-center gap-3 rounded-xl px-3 h-10 text-sm font-medium text-night-muted transition-colors hover:bg-white/5 hover:text-white"
        title="Sign out"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true"><path d="M15 12H4m0 0l4-4m-4 4l4 4M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span className="hidden lg:block">Sign out</span>
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
function IconPercent() { return base(<><path d="M19 5 5 19" {...S} /><circle cx="7.5" cy="7.5" r="2.5" {...S} /><circle cx="16.5" cy="16.5" r="2.5" {...S} /></>); }
