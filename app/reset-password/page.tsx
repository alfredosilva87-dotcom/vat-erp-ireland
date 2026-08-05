"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { getBrowserSupabase } from "@/lib/supabaseBrowser";

type Stage = "checking" | "invalid" | "ready" | "done";

export default function ResetPassword() {
  const { t } = useT();
  const [stage, setStage] = useState<Stage>("checking");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Supabase redirects an expired/already-used link back here with
    // "error=...&error_code=otp_expired" in the hash instead of a token —
    // the hash itself already tells us the link is dead, so handle that
    // directly rather than asking the SDK to make sense of an error hash.
    if (location.hash.includes("error=")) {
      console.warn("reset-password: recovery link error in URL —", location.hash);
      setStage("invalid");
      return;
    }

    let sub: { unsubscribe: () => void } | null = null;
    let cancelled = false;

    // A prior recovery attempt (or an SDK upgrade) can leave a stale/corrupt
    // entry in localStorage under this project's auth-token key. Letting
    // that throw here used to take the whole page down with it (Next's
    // generic "Application error" screen, no way back) — degrade to the
    // same "invalid" state instead, exactly like a bad link would.
    try {
      const sb = getBrowserSupabase();

      // The recovery link puts the token in the URL; the SDK parses it on
      // load and fires this event once the recovery session is established.
      const { data } = sb.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY" && session?.access_token) {
          setAccessToken(session.access_token);
          setStage("ready");
        }
      });
      sub = data.subscription;

      // Some browsers restore the session before the listener attaches —
      // check directly too, and give up after a few seconds if neither fires.
      sb.auth.getSession().then(({ data }) => {
        if (!cancelled && data.session?.access_token) {
          setAccessToken(data.session.access_token);
          setStage("ready");
        }
      }).catch((e) => {
        console.warn("reset-password: getSession failed —", e);
        if (!cancelled) setStage((s) => (s === "checking" ? "invalid" : s));
      });
    } catch (e) {
      console.warn("reset-password: Supabase client failed to initialise —", e);
      setStage("invalid");
      return;
    }

    const timeout = setTimeout(() => setStage((s) => (s === "checking" ? "invalid" : s)), 5000);

    return () => {
      cancelled = true;
      sub?.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError(t("reset.tooShort"));
    if (password !== confirm) return setError(t("reset.mismatch"));
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: accessToken, new_password: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("reset.invalidLink"));
      setStage("done");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <h2 className="font-display text-2xl font-semibold tracking-tight">{t("reset.title")}</h2>
        <p className="mt-1 text-sm text-muted">{t("reset.subtitle")}</p>

        {stage === "checking" && <p className="mt-6 text-sm text-muted">{t("reset.checkingLink")}</p>}

        {stage === "invalid" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-danger">{t("reset.invalidLink")}</p>
            <Link href="/login" className="btn-ghost inline-flex">{t("reset.backToLogin")}</Link>
          </div>
        )}

        {stage === "ready" && (
          <form onSubmit={submit} className="mt-7 space-y-4">
            <div>
              <label className="label" htmlFor="new-password">{t("reset.newPassword")}</label>
              <input
                id="new-password" type="password" autoComplete="new-password" className="input"
                value={password} onChange={(e) => setPassword(e.target.value)} required
              />
            </div>
            <div>
              <label className="label" htmlFor="confirm-password">{t("reset.confirmPassword")}</label>
              <input
                id="confirm-password" type="password" autoComplete="new-password" className="input"
                value={confirm} onChange={(e) => setConfirm(e.target.value)} required
              />
            </div>
            {error && (
              <div className="rounded-xl border border-danger/30 bg-danger-50 px-4 py-2.5 text-sm text-danger" role="alert">
                {error}
              </div>
            )}
            <button className="btn-primary w-full" type="submit" disabled={submitting}>
              {submitting ? t("reset.submitting") : t("reset.submit")}
            </button>
          </form>
        )}

        {stage === "done" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-ink">{t("reset.success")}</p>
            <Link href="/login" className="btn-primary inline-flex">{t("reset.backToLogin")}</Link>
          </div>
        )}
      </div>
    </div>
  );
}
