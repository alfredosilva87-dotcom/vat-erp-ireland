"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT, LANGS, type Lang } from "@/lib/i18n";
import FirmCard from "@/components/settings/FirmCard";

type Me = { id: string; email: string; name: string | null; role: string; company_id: string | null } | null;

export default function Settings() {
  const { t, lang, setLang } = useT();
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [me, setMe] = useState<Me>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseMsg, setLicenseMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // A licença ATUAL. Antes a tela só oferecia colar uma chave nova, sem dizer o
  // que já existia — e o dono do escritório é `admin`, então não vê o painel
  // master onde essa informação morava.
  const [license, setLicense] = useState<{
    name: string; slug: string; active: boolean; expiresAt: string | null;
    state: string; signed: boolean; pendingExpiresAt: string | null;
  } | null>(null);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as "dark" | "light") || "light");
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setMe(d.user ?? null)).catch(() => {});
  }, []);

  const loadLicense = useCallback(async (companyId: string) => {
    const r = await fetch(`/api/companies/${companyId}/activate`, { cache: "no-store" });
    if (r.ok) setLicense(await r.json());
  }, []);

  useEffect(() => {
    if (me?.company_id && (me.role === "admin" || me.role === "master")) loadLicense(me.company_id);
  }, [me, loadLicense]);

  async function activateLicense() {
    if (!me?.company_id || !licenseKey.trim()) return;
    setLicenseBusy(true);
    setLicenseMsg(null);
    try {
      const res = await fetch(`/api/companies/${me.company_id}/activate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: licenseKey.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Activation failed.");
      setLicenseMsg({ text: `Licence activated — valid until ${d.expiresAt}.`, ok: true });
      setLicenseKey("");
      if (me?.company_id) await loadLicense(me.company_id);
    } catch (e: any) {
      setLicenseMsg({ text: e.message, ok: false });
    } finally {
      setLicenseBusy(false);
    }
  }

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
            <div className="flex items-center gap-2">
              <Link href="/settings/permissions" className="btn-ghost h-9 px-3 text-xs">
                {t("perm.title")}
              </Link>
              <Link href="/settings/users" className="btn-primary h-9 px-3 text-xs">
                {t("settings.manageUsers")}
              </Link>
            </div>
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

      {/* Firm details — o timbre das demonstracoes */}
      {isAdmin && me?.company_id && <FirmCard companyId={me.company_id} />}

      {/* Licence */}
      {isAdmin && me?.company_id && (
        <section id="license" className="card p-5">
          <h2 className="font-display text-lg font-semibold">Licence</h2>

          {license && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface-2/50 p-3 text-sm">
              <span className={
                license.state === "ok" ? "chip-ok"
                : license.state === "expiring" ? "chip-warn"
                : license.state === "expired" || license.state === "inactive" ? "chip-danger"
                : "chip bg-surface-2 border border-line text-muted"
              }>
                {license.state === "ok" ? "valid"
                  : license.state === "expiring" ? "expiring soon"
                  : license.state === "expired" ? "expired"
                  : license.state === "inactive" ? "company inactive"
                  : "no licence"}
              </span>
              <span><b>{license.name}</b> <span className="font-mono text-xs text-muted">{license.slug}</span></span>
              {license.expiresAt && (
                <span>valid until <b className="tnum">{license.expiresAt}</b>
                  {" "}({Math.max(0, Math.round((new Date(license.expiresAt).getTime() - Date.now()) / 86400000))} days)
                </span>
              )}
              {license.signed && <span className="text-xs text-muted">signed key</span>}
              {license.pendingExpiresAt && (
                <span className="chip-warn">renewal pending → {license.pendingExpiresAt}</span>
              )}
            </div>
          )}

          <p className="mt-4 text-sm text-muted">
            Got a renewal key by e-mail? Paste it here. The system checks its signature on the
            spot — it needs no internet connection and nobody has to sign in to this installation.
          </p>
          <textarea
            className="input mt-2 h-24 w-full font-mono text-xs"
            placeholder="VATERP1.…"
            value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button className="btn-primary h-9 px-4 text-sm" disabled={licenseBusy || !licenseKey.trim()} onClick={activateLicense}>
              {licenseBusy ? "…" : "Activate"}
            </button>
            {licenseMsg && (
              <span className={`text-sm ${licenseMsg.ok ? "text-success" : "text-danger"}`}>{licenseMsg.text}</span>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">
            The key names the company it was issued for and the date it runs to, and it is signed.
            A key for another company, one that has expired, or one that would shorten the current
            licence is refused, and nothing changes.
          </p>
        </section>
      )}

    </div>
  );
}
