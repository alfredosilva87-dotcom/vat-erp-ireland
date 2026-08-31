"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT, type TKey } from "@/lib/i18n";
import { MARCA } from "@/lib/marca";

export default function Login() {
  const router = useRouter();
  const { t } = useT();

  // Supabase's own redirect can land here instead of /reset-password when
  // the target URL isn't in the project's Auth "Redirect URLs" allow-list —
  // it falls back to the Site URL, and our middleware's own redirect (no
  // session on "/") preserves the URL fragment along the way. Rescue the
  // recovery token client-side regardless of that dashboard setting.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery") && hash.includes("access_token=")) {
      window.location.href = `/reset-password${hash}`;
    }
  }, []);

  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    setForgotSending(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
    } finally {
      setForgotSending(false);
      setForgotSent(true);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, company: company.trim() || undefined }),
      });
      const data = await res.json();
      // The API returns an i18n key so the reason shows in the chosen language.
      if (!res.ok) throw new Error(data.messageKey ? t(data.messageKey as TKey) : (data.error || t("login.invalid")));
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      router.push(next);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-night lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(700px 400px at 15% 10%, rgb(var(--c-brand) / 0.38), transparent 60%), radial-gradient(600px 500px at 90% 90%, rgb(var(--c-violet) / 0.35), transparent 60%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <img src="/logo.png" alt={MARCA.nome} className="h-11 w-11 shrink-0 rounded-xl shadow-brand" />
          <div>
            <div className="font-display text-xl font-semibold text-white">{MARCA.nome}</div>
            <div className="text-xs font-medium tracking-wide text-night-muted">Ireland · Accounting ERP</div>
          </div>
        </div>

        <div className="relative">
          <h1 className="max-w-md font-display text-4xl font-semibold leading-tight text-white">
            Read invoices. Check VAT. File obligations.
          </h1>
          <p className="mt-4 max-w-md text-night-muted">
            Batch-read receipts and invoices, match Irish VAT rates, decide input credit and prepare
            bi-monthly VAT3 and annual RTD — per client, in one place.
          </p>
        </div>

        <div className="relative flex gap-6 text-sm text-night-muted">
          <span>✓ Multi-client</span>
          <span>✓ AI reading</span>
          <span>✓ Credit &amp; obligations</span>
        </div>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-b from-brand-400 to-brand-700 font-display text-2xl leading-none text-white shadow-brand">
              V
            </span>
          </div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">{t("login.signIn")}</h2>
          <p className="mt-1 text-sm text-muted">{t("login.welcome")}</p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <div>
              <label className="label" htmlFor="company">{t("login.company")}</label>
              <input
                id="company" className="input" value={company} autoComplete="organization"
                placeholder="precisetax"
                onChange={(e) => setCompany(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted">{t("login.companyHelp")}</p>
            </div>

            <div>
              <label className="label" htmlFor="email">{t("login.email")}</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">{t("login.password")}</label>
              <div className="relative">
                <input
                  id="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  className="input pr-16"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-muted hover:text-ink"
                >
                  {show ? t("login.hide") : t("login.show")}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-danger/30 bg-danger-50 px-4 py-2.5 text-sm text-danger" role="alert">
                {error}
              </div>
            )}

            <button className="btn-primary w-full" type="submit" disabled={loading}>
              {loading ? t("login.signingIn") : t("login.signIn")}
            </button>

            <button
              type="button"
              className="block w-full text-center text-xs text-muted hover:text-ink"
              onClick={() => { setForgotOpen((v) => !v); setForgotSent(false); }}
            >
              {t("login.forgotPassword")}
            </button>
          </form>

          {forgotOpen && (
            <div className="mt-4 rounded-xl border border-line bg-surface-2/50 p-4">
              {forgotSent ? (
                <p className="text-sm text-muted">{t("login.forgotSent")}</p>
              ) : (
                <form onSubmit={submitForgot} className="space-y-2">
                  <label className="label" htmlFor="forgot-email">{t("login.forgotEmail")}</label>
                  <input
                    id="forgot-email"
                    type="email"
                    className="input"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                  />
                  <div className="flex items-center gap-2 pt-1">
                    <button className="btn-primary h-9 flex-1 text-sm" type="submit" disabled={forgotSending}>
                      {forgotSending ? t("login.forgotSending") : t("login.forgotSubmit")}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost h-9 px-3 text-sm"
                      onClick={() => setForgotOpen(false)}
                    >
                      {t("login.forgotCancel")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          <p className="mt-8 text-center text-xs text-muted">
            {t("login.protected")}
          </p>
        </div>
      </div>
    </div>
  );
}
