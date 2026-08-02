"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT, LANGS, type Lang } from "@/lib/i18n";

type Me = { id: string; email: string; name: string | null; role: string } | null;

export default function Settings() {
  const { t, lang, setLang } = useT();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [me, setMe] = useState<Me>(null);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as "dark" | "light") || "dark");
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setMe(d.user ?? null)).catch(() => {});
  }, []);

  function pickTheme(next: "dark" | "light") {
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("vat-theme", next); } catch { /* not persisted */ }
    setTheme(next);
  }

  const isAdmin = me?.role === "admin" || me?.role === "master";

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="mt-1 text-muted">{t("settings.subtitle")}</p>
      </div>

      {/* Appearance */}
      <section className="card p-5">
        <h2 className="font-display text-lg font-semibold">{t("settings.appearance")}</h2>
        <p className="text-sm text-muted">{t("settings.appearanceSub")}</p>

        <div className="mt-4">
          <div className="label">{t("settings.theme")}</div>
          <div className="flex gap-2">
            {([["dark", "settings.themeDark"], ["light", "settings.themeLight"]] as const).map(([k, key]) => (
              <button
                key={k}
                onClick={() => pickTheme(k)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  theme === k ? "bg-brand text-white" : "bg-surface-2 text-muted hover:text-ink"
                }`}
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="label">{t("settings.language")}</div>
          <p className="mb-2 text-xs text-muted">{t("settings.languageSub")}</p>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {LANGS.map((l) => (
              <button
                key={l.code}
                onClick={() => setLang(l.code as Lang)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                  lang === l.code
                    ? "border-brand bg-brand-50 text-brand-700"
                    : "border-line bg-surface-2/50 text-ink hover:border-brand/50"
                }`}
              >
                <span className="text-lg leading-none">{l.flag}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{l.label}</span>
                  {!l.complete && (
                    <span className="block text-[11px] text-muted">{t("settings.partial")}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Users */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">{t("settings.users")}</h2>
            <p className="text-sm text-muted">{t("settings.usersSub")}</p>
          </div>
          {isAdmin ? (
            <Link href="/settings/users" className="btn-primary h-9 px-3 text-xs">
              {t("settings.manageUsers")}
            </Link>
          ) : (
            <span className="chip bg-surface-2 text-muted">{t("settings.adminOnly")}</span>
          )}
        </div>

        {me && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-surface-2/50 p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-semibold text-white">
              {(me.name || me.email).slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{me.name || me.email}</div>
              <div className="text-xs text-muted">
                {me.email} · {me.role === "master" ? t("users.roleMaster") : me.role === "admin" ? t("users.roleAdmin") : t("users.roleUser")}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
