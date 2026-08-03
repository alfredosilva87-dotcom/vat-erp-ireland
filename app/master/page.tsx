"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import type { Company } from "@/lib/types";
import { licenseStatus } from "@/lib/license";

type Stats = Record<string, { clients: number; users: number }>;
const emptyForm = { name: "", slug: "", contact_email: "", months: 12 };

export default function Master() {
  const { t } = useT();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [form, setForm] = useState({ ...emptyForm });
  const [showForm, setShowForm] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/companies");
    if (res.status === 401 || res.status === 403) { setForbidden(true); setLoading(false); return; }
    const d = await res.json();
    setCompanies(d.companies || []);
    setStats(d.stats || {});
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setMsg(null);
    const res = await fetch("/api/companies", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error); return; }
    setForm({ ...emptyForm }); setShowForm(false);
    load();
  }

  async function patch(id: string, body: any) {
    const res = await fetch(`/api/companies/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error); return; }
    setMsg(null);
    load();
  }

  const licenceState = (c: Company) => {
    const state = licenseStatus(c.license_expires_at, c.active);
    switch (state) {
      case "inactive": return { cls: "chip-danger", label: t("master.inactive") };
      case "none": return { cls: "chip bg-surface-2 text-muted", label: t("master.noLicense") };
      case "expired": return { cls: "chip-danger", label: t("master.expired") };
      case "expiring": return { cls: "chip-warn", label: t("master.expiringSoon") };
      case "ok": return { cls: "chip-ok", label: t("master.valid") };
    }
  };

  if (forbidden) {
    return (
      <div className="card p-8 text-center">
        <p className="text-muted">{t("master.forbidden")}</p>
        <Link href="/" className="btn-ghost mt-4 inline-flex">{t("common.back")}</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{t("master.title")}</h1>
          <p className="mt-1 text-muted">{t("master.subtitle")}</p>
        </div>
        <button className="btn-primary" onClick={() => { setShowForm((v) => !v); setMsg(null); }}>
          {showForm ? t("common.close") : t("master.newCompany")}
        </button>
      </div>

      {showForm && (
        <div className="card rise p-5">
          <h2 className="font-display text-lg font-semibold">{t("master.newCompany")}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label">{t("master.name")} *</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">{t("master.slug")}</label>
              <input
                className="input font-mono" value={form.slug} placeholder={t("master.slugAuto")}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t("master.contact")}</label>
              <input className="input" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
            </div>
            <div>
              <label className="label">{t("master.licenseMonths")}</label>
              <select className="input" value={form.months} onChange={(e) => setForm({ ...form, months: Number(e.target.value) })}>
                {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">{t("master.slugHelp")}</p>
          <div className="mt-4 flex items-center gap-3">
            <button className="btn-primary" onClick={create}>{t("common.create")}</button>
            {msg && <span className="text-sm text-danger">{msg}</span>}
          </div>
        </div>
      )}

      {msg && !showForm && <p className="text-sm text-danger">{msg}</p>}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">{t("master.company")}</th>
                <th className="px-4 py-3 font-medium">{t("master.licenseKey")}</th>
                <th className="px-4 py-3 font-medium">{t("master.expiresOn")}</th>
                <th className="px-4 py-3 font-medium text-right">{t("nav.clients")}</th>
                <th className="px-4 py-3 font-medium text-right">{t("settings.users")}</th>
                <th className="px-4 py-3 font-medium">{t("common.status")}</th>
                <th className="px-4 py-3 font-medium text-center">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => {
                const st = licenceState(c);
                const s = stats[c.id] || { clients: 0, users: 0 };
                return (
                  <tr key={c.id} className="border-b border-line/70">
                    <td className="px-4 py-3">
                      <div className="font-medium">{c.name}</div>
                      <div className="font-mono text-xs text-muted">{c.slug}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{c.license_key || "—"}</td>
                    <td className="px-4 py-3 tnum">{c.license_expires_at || "—"}</td>
                    <td className="px-4 py-3 text-right tnum">{s.clients}</td>
                    <td className="px-4 py-3 text-right tnum">{s.users}</td>
                    <td className="px-4 py-3"><span className={st.cls}>{st.label}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        <button className="btn-ghost h-8 px-3 text-xs" onClick={() => patch(c.id, { renewMonths: 12 })}>
                          {t("master.renew")}
                        </button>
                        <button className="btn-ghost h-8 px-3 text-xs" onClick={() => patch(c.id, { regenerateKey: true })}>
                          {t("master.newKey")}
                        </button>
                        <button
                          className={`btn-ghost h-8 px-3 text-xs ${c.active ? "text-danger" : ""}`}
                          onClick={() => patch(c.id, { active: !c.active })}
                        >
                          {c.active ? t("users.deactivate") : t("users.activate")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!companies.length && !loading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">{t("master.empty")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted">{t("master.footer")}</p>
    </div>
  );
}
