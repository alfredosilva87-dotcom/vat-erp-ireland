"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import PermissionTree from "@/components/PermissionTree";
import { ALL_PERM_IDS, PERM_TREE } from "@/lib/permissions";

type User = {
  id: string; email: string; name: string | null;
  role: "user" | "admin" | "master"; active: boolean;
  screen_access: string[] | null;
};

/**
 * A tela de permissões: quem à esquerda, o que ele alcança à direita.
 *
 * Ficava como uma fileira de caixas dentro do formulário de usuário, junto de
 * nome e senha. Errado por dois motivos: quem mexe em permissão está pensando
 * no time, não numa pessoa — e um formulário que só abre para editar esconde
 * exatamente a pergunta que se faz na auditoria, que é "quem enxerga o quê".
 * Aqui a lista responde isso sem abrir nada.
 *
 * Só perfil `master` fica de fora da edição: ele vê tudo por definição, e
 * oferecer caixas que não têm efeito é pior do que não oferecer.
 */
export default function Permissions() {
  const { t } = useT();
  const [users, setUsers] = useState<User[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (keep?: string | null) => {
    const res = await fetch("/api/users", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) { setForbidden(true); setLoading(false); return; }
    const d = await res.json();
    const list: User[] = d.users || [];
    setUsers(list);
    setLoading(false);
    // `?user=` vem do link da tela de usuários; sem ele, abre no primeiro.
    const wanted = keep
      ?? new URLSearchParams(window.location.search).get("user")
      ?? list[0]?.id
      ?? null;
    const found = list.find((u) => u.id === wanted) ?? list[0] ?? null;
    setSel(found?.id ?? null);
    setDraft(found?.screen_access ?? null);
  }, []);

  useEffect(() => { load(); }, [load]);

  function pick(u: User) {
    setSel(u.id);
    setDraft(u.screen_access ?? null);
    setMsg(null);
  }

  async function save() {
    if (!sel) return;
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/users/${sel}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screen_access: draft }),
    });
    const d = await res.json();
    setSaving(false);
    if (!res.ok) { setMsg({ text: d.error, ok: false }); return; }
    setMsg({ text: t("perm.saved"), ok: true });
    await load(sel);
  }

  const current = users.find((u) => u.id === sel) ?? null;
  const isMaster = current?.role === "master";
  const stored = current?.screen_access ?? null;
  const dirty = JSON.stringify(stored) !== JSON.stringify(draft);

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
      <div className="rise">
        <Link href="/settings" className="text-sm text-brand-700">← {t("settings.title")}</Link>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{t("perm.title")}</h1>
        <p className="mt-1 text-muted">{t("perm.subtitle")}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        {/* Quem */}
        <div className="card overflow-hidden self-start">
          <div className="border-b border-line px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted">
            {t("perm.people")}
          </div>
          <ul>
            {users.map((u) => (
              <li key={u.id}>
                <button
                  onClick={() => pick(u)}
                  className={`flex w-full items-center gap-2 border-b border-line/60 px-4 py-2.5 text-left transition-colors ${
                    u.id === sel ? "bg-brand-50/70" : "hover:bg-surface-2/50"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{u.name || u.email}</span>
                    <span className="block truncate text-[11px] text-muted">{summary(u, t)}</span>
                  </span>
                  {!u.active && <span className="chip bg-surface-2 text-[10px] text-muted">{t("common.inactive")}</span>}
                </button>
              </li>
            ))}
            {!users.length && !loading && (
              <li className="px-4 py-8 text-center text-sm text-muted">{t("users.empty")}</li>
            )}
          </ul>
          <Link href="/settings/users" className="block px-4 py-2.5 text-xs text-brand-700">
            {t("perm.manageUsers")} →
          </Link>
        </div>

        {/* O quê */}
        <div className="card p-5">
          {!current ? (
            <p className="py-10 text-center text-muted">{t("perm.pickPerson")}</p>
          ) : isMaster ? (
            <>
              <Header user={current} t={t} />
              <p className="mt-4 rounded-xl bg-surface-2/60 px-4 py-3 text-sm text-muted">
                {t("perm.masterNote")}
              </p>
            </>
          ) : (
            <>
              <Header user={current} t={t} />
              <div className="mt-4">
                <PermissionTree value={draft} onChange={setDraft} disabled={saving} />
              </div>
              <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
                <button className="btn-primary" onClick={save} disabled={saving || !dirty}>
                  {saving ? t("common.saving") : t("common.saveChanges")}
                </button>
                {dirty && !saving && <span className="text-xs text-muted">{t("perm.unsaved")}</span>}
                {msg && (
                  <span className={`text-sm ${msg.ok ? "text-muted" : "text-danger"}`}>{msg.text}</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Header({ user, t }: { user: User; t: (k: any, v?: any) => string }) {
  const role = user.role === "master" ? t("users.roleMaster")
    : user.role === "admin" ? t("users.roleAdmin") : t("users.roleUser");
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <h2 className="truncate font-display text-lg font-semibold">{user.name || user.email}</h2>
        <p className="truncate font-mono text-xs text-muted">{user.email}</p>
      </div>
      <span className={user.role === "user" ? "chip bg-surface-2 text-muted" : "chip bg-brand-50 text-brand-700"}>
        {role}
      </span>
    </div>
  );
}

/** A linha de baixo na lista: o recorte da pessoa, sem precisar abrir. */
function summary(u: User, t: (k: any, v?: any) => string): string {
  if (u.role === "master") return t("perm.summaryMaster");
  const ids = u.screen_access;
  if (!ids || !ids.length) return t("perm.summaryAll");
  const groups = PERM_TREE.filter((g) => g.screens.some((s) => ids.includes(s.id))).map((g) => t(g.labelKey));
  return `${t("perm.count", { n: ids.length, total: ALL_PERM_IDS.length })} · ${groups.join(", ")}`;
}
