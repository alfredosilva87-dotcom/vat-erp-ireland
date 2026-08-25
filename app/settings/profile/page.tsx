"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

type Profile = {
  id: string; email: string; name: string | null; surname: string | null;
  phone: string | null; avatar: string | null; role: string; created_at?: string;
};

/**
 * A própria conta.
 *
 * Existe porque num escritório com várias pessoas a lançar no mesmo cliente,
 * "quem aprovou esta nota" respondia com um e-mail — e o e-mail costuma ser
 * `accounts@`, que não é de ninguém. Nome e foto dão cara ao histórico.
 *
 * O que NÃO está aqui, de propósito: perfil, ativo e permissões. Quem muda
 * isso é um administrador, na tela de utilizadores. Um formulário de "minha
 * conta" que deixasse mexer no próprio perfil seria uma promoção com dois
 * cliques.
 */
export default function ProfilePage() {
  const { t } = useT();
  const [p, setP] = useState<Profile | null>(null);
  const [form, setForm] = useState({ name: "", surname: "", phone: "", password: "" });
  const [avatar, setAvatar] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ texto: string; ok: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/profile", { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    const perfil: Profile | null = d.profile;
    setP(perfil);
    if (perfil) {
      setForm({
        name: perfil.name ?? "", surname: perfil.surname ?? "",
        phone: perfil.phone ?? "", password: "",
      });
      setAvatar(perfil.avatar);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Reduz a foto antes de enviar.
   *
   * Um retrato de telemóvel tem 4 MB e 4000px de largura para caber num círculo
   * de 32px. Sem reduzir, esses 4 MB passavam a viajar em toda chamada de
   * `/api/auth/me` — que é a chamada que TODA tela faz — e o sistema ficava
   * lento sem que ninguém ligasse a causa ao efeito.
   *
   * Recorta pelo centro no lado menor, porque o destino é sempre um círculo:
   * encolher sem recortar deixaria a pessoa achatada.
   */
  function escolherFoto(file: File) {
    setMsg(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setMsg({ texto: t("profile.badType"), ok: false });
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const lado = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 256, 256);
      setAvatar(canvas.toDataURL("image/jpeg", 0.85));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setMsg({ texto: t("profile.badImage"), ok: false });
    };
    img.src = url;
  }

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    const body: Record<string, unknown> = {
      name: form.name, surname: form.surname, phone: form.phone, avatar,
    };
    if (form.password) body.password = form.password;

    const r = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    setSalvando(false);
    if (!r.ok) { setMsg({ texto: d.error, ok: false }); return; }
    setMsg({ texto: t("profile.saved"), ok: true });
    setForm((f) => ({ ...f, password: "" }));
    await load();
  }

  const iniciais = (p?.name || p?.email || "?").slice(0, 2).toUpperCase();
  const papel = p?.role === "master" ? t("users.roleMaster")
    : p?.role === "admin" ? t("users.roleAdmin") : t("users.roleUser");

  return (
    <div className="space-y-6">
      <div className="rise">
        <Link href="/settings" className="text-sm text-brand-700">← {t("settings.title")}</Link>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{t("profile.title")}</h1>
        <p className="mt-1 text-muted">{t("profile.subtitle")}</p>
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-brand font-display text-2xl font-semibold text-white shadow-brand">
            {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : iniciais}
          </span>
          <div className="min-w-0">
            <div className="font-display text-lg font-semibold">
              {[form.name, form.surname].filter(Boolean).join(" ") || p?.email || "—"}
            </div>
            <div className="font-mono text-xs text-muted">{p?.email}</div>
            <span className="mt-1 inline-block chip bg-brand-50 text-brand-700">{papel}</span>
          </div>
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
              {t("profile.choosePhoto")}
            </button>
            {avatar && (
              <button className="btn-ghost text-danger" onClick={() => setAvatar(null)}>
                {t("profile.removePhoto")}
              </button>
            )}
            <input
              ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) escolherFoto(f); e.target.value = ""; }}
            />
          </div>
        </div>

        <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">{t("profile.firstName")}</label>
            <input className="input" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">{t("profile.surname")}</label>
            <input className="input" value={form.surname}
              onChange={(e) => setForm({ ...form, surname: e.target.value })} />
          </div>
          <div>
            <label className="label">{t("profile.phone")}</label>
            <input className="input" value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="label">{t("profile.email")}</label>
            {/* O e-mail é a identidade de acesso: mudá-lo aqui trocaria o login
                sem confirmação nenhuma. Fica visível e travado. */}
            <input className="input" value={p?.email ?? ""} disabled />
          </div>
          <div>
            <label className="label">{t("profile.newPassword")}</label>
            <input
              className="input" type="password" value={form.password}
              placeholder={t("profile.passwordKeep")}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
          <button className="btn-primary" onClick={salvar} disabled={salvando}>
            {salvando ? t("common.saving") : t("common.saveChanges")}
          </button>
          {msg && (
            <span className={`text-sm ${msg.ok ? "text-muted" : "text-danger"}`}>{msg.texto}</span>
          )}
        </div>
      </div>

      <p className="text-xs text-muted">{t("profile.rolesNote")}</p>
    </div>
  );
}
