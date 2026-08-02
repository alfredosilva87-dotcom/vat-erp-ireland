"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

type User = {
  id: string; email: string; name: string | null;
  role: "user" | "admin" | "master"; active: boolean; created_at: string;
};

const empty = { name: "", email: "", password: "", role: "user" as User["role"] };

export default function Users() {
  const { t } = useT();
  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/users");
    if (res.status === 401 || res.status === 403) { setForbidden(true); setLoading(false); return; }
    const d = await res.json();
    setUsers(d.users || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setMe(d.user ?? null));
    load();
  }, [load]);

  async function submit() {
    setMsg(null);
    const url = editId ? `/api/users/${editId}` : "/api/users";
    const body: any = { name: form.name, role: form.role };
    if (!editId) { body.email = form.email; body.password = form.password; }
    else if (form.password) body.password = form.password;

    const res = await fetch(url, {
      method: editId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error); return; }
    setForm({ ...empty }); setEditId(null); setShowForm(false);
    setMsg(editId ? t("users.updated") : t("users.created"));
    load();
  }

  function edit(u: User) {
    setEditId(u.id);
    setForm({ name: u.name || "", email: u.email, password: "", role: u.role });
    setShowForm(true);
    setMsg(null);
  }

  async function toggleActive(u: User) {
    const res = await fetch(`/api/users/${u.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !u.active }),
    });
    const d = await res.json();
    if (!res.ok) setMsg(d.error); else load();
  }

  async function remove(u: User) {
    if (!confirm(t("users.deleteConfirm"))) return;
    const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    const d = await res.json();
    if (!res.ok) setMsg(d.error); else load();
  }

  const roleLabel = (r: string) =>
    r === "master" ? t("users.roleMaster") : r === "admin" ? t("users.roleAdmin") : t("users.roleUser");

  if (forbidden) {
    return (
      <div className="card p-8 text-center">
        <p className="text-muted">{t("users.forbidden")}</p>
        <Link href="/settings" className="btn-ghost mt-4 inline-flex">{t("common.back")}</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/settings" className="text-sm text-brand-700">← {t("settings.title")}</Link>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{t("users.title")}</h1>
          <p className="mt-1 text-muted">{t("users.subtitle")}</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => { setEditId(null); setForm({ ...empty }); setShowForm((v) => !v); setMsg(null); }}
        >
          {showForm ? t("common.close") : t("users.new")}
        </button>
      </div>

      {showForm && (
        <div className="card rise p-5">
          <h2 className="font-display text-lg font-semibold">
            {editId ? t("users.editUser") : t("users.new")}
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label">{t("users.name")}</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">{t("users.email")} *</label>
              <input
                className="input" type="email" value={form.email} disabled={!!editId}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t("users.password")} {!editId && "*"}</label>
              <input
                className="input" type="password" value={form.password}
                placeholder={editId ? t("users.passwordKeep") : ""}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t("users.role")}</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User["role"] })}>
                <option value="user">{t("users.roleUser")}</option>
                <option value="admin">{t("users.roleAdmin")}</option>
                {me?.role === "master" && <option value="master">{t("users.roleMaster")}</option>}
              </select>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            {form.role === "user" ? t("users.roleUserHelp") : t("users.roleAdminHelp")}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button className="btn-primary" onClick={submit}>
              {editId ? t("common.saveChanges") : t("common.create")}
            </button>
            {msg && <span className="text-sm text-danger">{msg}</span>}
          </div>
        </div>
      )}

      {msg && !showForm && <p className="text-sm text-muted">{msg}</p>}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">{t("users.name")}</th>
                <th className="px-4 py-3 font-medium">{t("users.email")}</th>
                <th className="px-4 py-3 font-medium">{t("users.role")}</th>
                <th className="px-4 py-3 font-medium">{t("users.status")}</th>
                <th className="px-4 py-3 font-medium text-center">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-line/70">
                  <td className="px-4 py-3 font-medium">
                    {u.name || "—"}
                    {u.id === me?.id && <span className="ml-2 chip bg-brand-50 text-brand-700">you</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={u.role === "user" ? "chip bg-surface-2 text-muted" : "chip bg-brand-50 text-brand-700"}>
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.active ? <span className="chip-ok">{t("common.active")}</span> : <span className="chip bg-surface-2 text-muted">{t("common.inactive")}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button className="btn-ghost h-8 px-3 text-xs" onClick={() => edit(u)}>{t("common.edit")}</button>
                      <button className="btn-ghost h-8 px-3 text-xs" onClick={() => toggleActive(u)} disabled={u.id === me?.id}>
                        {u.active ? t("users.deactivate") : t("users.activate")}
                      </button>
                      <button className="btn-ghost h-8 px-3 text-xs text-danger" onClick={() => remove(u)} disabled={u.id === me?.id}>
                        {t("common.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length && !loading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">{t("users.empty")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
