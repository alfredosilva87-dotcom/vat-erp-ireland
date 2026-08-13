"use client";

/**
 * Os links de envio por telefone deste cliente (camada B4).
 *
 * Um link por PESSOA, não por cliente: o motorista e o dono da loja mandam pelo
 * mesmo cliente, e quando um telefone se perde revoga-se só aquele. O nome
 * aparece na fila, e é por isso que dois nomes iguais no mesmo cliente são
 * recusados — a foto de recibo de posto é igual à seguinte, o nome é o que
 * distingue.
 *
 * Quem abre o link **não tem senha**: é cliente do escritório, não usuário.
 * Senha protege leitura, e este link só escreve. Ver `lib/phoneIntake.ts`.
 *
 * O link aparece inteiro e com botão de copiar porque o uso dele é ser colado
 * numa mensagem de WhatsApp — mostrar só o token daria metade do que se precisa,
 * mesma razão da tela de e-mail.
 */

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

type Link = {
  id: string; client_id: string; token: string; person: string;
  allow_sale: boolean; active: boolean; expires_at: string | null;
  last_used_at: string | null; synced_at: string | null; created_at: string;
};

const day = (s: string | null) => (s ? s.slice(0, 10) : null);

export default function ClientPhoneLinks({ clientId }: { clientId: string }) {
  const { t } = useT();
  const [links, setLinks] = useState<Link[]>([]);
  const [captureBase, setCaptureBase] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [person, setPerson] = useState("");
  const [allowSale, setAllowSale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/clients/${clientId}/phone-links`, { cache: "no-store" });
    const d = await r.json();
    setLinks(d.links || []);
    setCaptureBase(d.captureBase ?? null);
    setConfigured(Boolean(d.configured));
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const urlOf = (l: Link) => (captureBase ? `${captureBase}/enviar/${l.token}` : null);

  async function create() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/phone-links`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person, allow_sale: allowSale }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg({ text: d.error || t("phone.failed"), error: true }); return; }
      setPerson(""); setAllowSale(false);
      // O erro de sincronização é DITO mesmo com o link criado: silêncio aqui
      // faria o contador mandar por WhatsApp um endereço que ainda não abre.
      setMsg(d.syncError ? { text: d.syncError, error: true } : { text: t("phone.created") });
      await load();
    } finally { setBusy(false); }
  }

  async function patch(id: string, body: Record<string, unknown>, okText: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/phone-links/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) { setMsg({ text: d.error || t("phone.failed"), error: true }); return; }
      setMsg(d.syncError ? { text: d.syncError, error: true } : { text: okText });
      await load();
    } finally { setBusy(false); }
  }

  return (
    <div>
      <h2 className="font-display text-xl">{t("phone.title")}</h2>
      <p className="mt-1 text-sm text-muted">{t("phone.subtitle")}</p>

      {!configured && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {t("phone.notConfigured")}
        </p>
      )}
      {configured && !captureBase && (
        // Sem o endereço da captura o token é inútil para o contador: ele não tem
        // como montar o link sozinho, porque a tela mora na nuvem.
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {t("phone.noCaptureUrl")}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <label className="label">{t("phone.person")}</label>
          <input className="input h-10 w-56" value={person} maxLength={80}
            placeholder={t("phone.personPlaceholder")}
            onChange={(e) => setPerson(e.target.value)} />
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={allowSale} onChange={(e) => setAllowSale(e.target.checked)} />
          {t("phone.allowSale")}
        </label>
        <button className="btn-primary h-10" onClick={create} disabled={busy || !person.trim() || !configured}>
          {t("phone.create")}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">{t("phone.allowSaleHint")}</p>

      {msg && (
        <p className={`mt-3 text-sm ${msg.error ? "text-red-600" : "text-emerald-700"}`}>{msg.text}</p>
      )}

      <ul className="mt-5 grid gap-3">
        {links.map((l) => {
          const url = urlOf(l);
          return (
            <li key={l.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{l.person}</span>
                {!l.active && <span className="chip">{t("phone.revoked")}</span>}
                {l.active && !l.synced_at && <span className="chip chip-warn">{t("phone.notSynced")}</span>}
                {l.allow_sale && <span className="chip">{t("phone.salesToo")}</span>}
                <span className="ml-auto text-xs text-muted">
                  {l.last_used_at
                    ? t("phone.lastUsed", { d: day(l.last_used_at) || "" })
                    : t("phone.neverUsed")}
                </span>
              </div>

              {l.active && url && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs">{url}</code>
                  <button className="btn-ghost h-8 px-3 text-xs"
                    onClick={() => { navigator.clipboard?.writeText(url); setMsg({ text: t("phone.copied") }); }}>
                    {t("phone.copy")}
                  </button>
                </div>
              )}

              <div className="mt-2 flex flex-wrap gap-2">
                {l.active && !l.synced_at && (
                  <button className="btn-ghost h-8 px-3 text-xs" disabled={busy}
                    onClick={() => patch(l.id, { resync: true }, t("phone.synced"))}>
                    {t("phone.resync")}
                  </button>
                )}
                {l.active ? (
                  <>
                    <button className="btn-ghost h-8 px-3 text-xs" disabled={busy}
                      onClick={() => patch(l.id, { rotate: true }, t("phone.rotated"))}>
                      {t("phone.rotate")}
                    </button>
                    <button className="btn-ghost h-8 px-3 text-xs text-red-600" disabled={busy}
                      onClick={() => patch(l.id, { active: false }, t("phone.revokedOk"))}>
                      {t("phone.revoke")}
                    </button>
                  </>
                ) : (
                  <button className="btn-ghost h-8 px-3 text-xs" disabled={busy}
                    onClick={() => patch(l.id, { active: true }, t("phone.reactivated"))}>
                    {t("phone.reactivate")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {!links.length && <p className="mt-4 text-sm text-muted">{t("phone.empty")}</p>}

      <p className="mt-4 text-xs text-muted">{t("phone.security")}</p>
    </div>
  );
}
