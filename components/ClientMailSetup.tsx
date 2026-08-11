"use client";

/**
 * O endereço de e-mail do cliente e quem pode mandar para ele (camada B2).
 *
 * Dois endereços, um para compra e um para venda, porque uma nota que entra como
 * venda quando era compra troca o sinal do VAT — não é um detalhe de organização.
 *
 * O endereço aparece inteiro e com botão de copiar porque o uso dele é ser colado
 * no cadastro do fornecedor. Mostrar só o token daria ao contador metade do que
 * ele precisa.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

type Route = {
  id: string; client_id: string; direction: "purchase" | "sale";
  token: string; active: boolean; created_at: string;
};
type Sender = {
  id: string; client_id: string | null; pattern: string;
  mode: "allow" | "block"; note: string | null;
};

const DIRECTIONS = [
  { v: "purchase" as const, label: "mail.dirPurchase" as const, hint: "mail.dirPurchaseHint" as const },
  { v: "sale" as const, label: "mail.dirSale" as const, hint: "mail.dirSaleHint" as const },
];

export default function ClientMailSetup({ clientId }: { clientId: string }) {
  const { t } = useT();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [base, setBase] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pattern, setPattern] = useState("");
  const [mode, setMode] = useState<"allow" | "block">("allow");
  const [global, setGlobal] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    const [r, s] = await Promise.all([
      fetch(`/api/clients/${clientId}/mail-routes`, { cache: "no-store" }),
      fetch(`/api/clients/${clientId}/mail-senders`, { cache: "no-store" }),
    ]);
    const rd = await r.json();
    setRoutes(rd.routes || []);
    setBase(rd.inbox_address ?? null);
    setConfigured(Boolean(rd.configured));
    setSenders((await s.json()).senders || []);
    setLoading(false);
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  const addressFor = (token: string) => {
    if (!base) return null;
    const at = base.lastIndexOf("@");
    if (at <= 0) return null;
    return `${base.slice(0, at)}+${token}${base.slice(at)}`;
  };

  async function createRoute(direction: "purchase" | "sale") {
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/mail-routes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      const d = await res.json();
      setMsg(res.ok ? { text: t("mail.created") } : { text: d.error || t("sup.error"), error: true });
      await load();
    } finally { setBusy(false); }
  }

  async function patchRoute(id: string, body: any, message: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/mail-routes/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json();
      setMsg(res.ok ? { text: message } : { text: d.error || t("sup.error"), error: true });
      await load();
    } finally { setBusy(false); }
  }

  async function addSender() {
    if (!pattern.trim()) { setMsg({ text: t("mail.needPattern"), error: true }); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/mail-senders`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern, mode, global }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ text: d.error || t("sup.error"), error: true }); return; }
      setPattern(""); setMsg({ text: mode === "allow" ? t("mail.senderAllowed") : t("mail.senderBlocked") });
      await load();
    } finally { setBusy(false); }
  }

  async function removeSender(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/clients/${clientId}/mail-senders/${id}`, { method: "DELETE" });
      await load();
    } finally { setBusy(false); }
  }

  const allows = senders.filter((s) => s.mode === "allow");
  const blocks = senders.filter((s) => s.mode === "block");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold">{t("mail.title")}</h2>
        <p className="mt-0.5 text-sm text-muted">
          {t("mail.subtitle1")} <strong>{t("mail.subtitleStrong")}</strong> {t("mail.subtitle2")}{" "}
          <Link href="/inbox" className="text-brand-700">{t("mail.inboxLink")}</Link> {t("mail.subtitle3")}
        </p>
      </div>

      {!configured && (
        <div className="card border border-warning/30 bg-warning-50 p-4 text-sm text-warning">
          {t("mail.notConfigured")}
        </div>
      )}

      <div className="space-y-3">
        {DIRECTIONS.map((d) => {
          const route = routes.find((r) => r.direction === d.v);
          const address = route ? addressFor(route.token) : null;
          return (
            <div key={d.v} className={`card p-4 ${route && !route.active ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{t(d.label)}</p>
                  <p className="mt-0.5 text-sm text-muted">{t(d.hint)}</p>
                  {route && (
                    <p className="mt-2 break-all font-mono text-sm">
                      {address ?? (
                        <span className="text-muted">
                          {t("mail.tokenOnly", { token: route.token })}
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!route ? (
                    <button className="btn-primary h-9 px-4 text-sm" disabled={busy}
                      onClick={() => createRoute(d.v)}>{t("mail.createAddress")}</button>
                  ) : (
                    <>
                      {address && (
                        <button className="btn-ghost h-9 px-3 text-sm"
                          onClick={() => { navigator.clipboard?.writeText(address); setMsg({ text: t("mail.copied") }); }}>
                          {t("mail.copy")}
                        </button>
                      )}
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input type="checkbox" checked={route.active} disabled={busy}
                          onChange={(e) => patchRoute(route.id, { active: e.target.checked },
                            e.target.checked ? t("mail.activeOn") : t("mail.activeOff"))} />
                        {t("common.active").toLowerCase()}
                      </label>
                      <button className="btn-ghost h-9 px-3 text-sm" disabled={busy}
                        onClick={() => {
                          if (!confirm(t("mail.rotateConfirm"))) return;
                          patchRoute(route.id, { rotate: true }, t("mail.rotated"));
                        }}>
                        {t("mail.rotate")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted">
        {t("mail.tokenNote")}
      </p>

      <div className="card p-4">
        <p className="label mb-2">{t("mail.sendersTitle")}</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_150px_auto]">
          <input className="input" placeholder={t("mail.senderPlaceholder")}
            value={pattern} onChange={(e) => setPattern(e.target.value)} />
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as "allow" | "block")}>
            <option value="allow">{t("mail.allow")}</option>
            <option value="block">{t("mail.block")}</option>
          </select>
          <button className="btn-primary" onClick={addSender} disabled={busy}>{t("common.add")}</button>
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} />
          {t("mail.globalPre")} <strong>{t("mail.globalStrong")}</strong> {t("mail.globalPost")}
        </label>

        <div className="mt-3 rounded-lg bg-surface-2/60 px-3 py-2 text-xs text-muted">
          <strong>{t("mail.blockWinsStrong")}</strong> {t("mail.blockWins")}
          <br />
          <strong>{t("mail.openBoxStrong")}</strong> {t("mail.openBox")}
          {allows.length > 0 && (
            <>
              <br />
              <strong className="text-warning">
                {t("mail.allowListOn", { n: allows.length })}
              </strong>
            </>
          )}
        </div>

        {loading ? (
          <p className="mt-3 text-sm text-muted">{t("common.loading")}</p>
        ) : !senders.length ? (
          <p className="mt-3 text-sm text-muted">{t("mail.noSenders")}</p>
        ) : (
          <div className="mt-3 space-y-3">
            {[{ list: allows, title: t("mail.allowedTitle") }, { list: blocks, title: t("mail.blockedTitle") }]
              .filter((g) => g.list.length)
              .map((g) => (
                <div key={g.title}>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted">{g.title}</p>
                  <div className="divide-y divide-line/70 rounded-lg border border-line">
                    {g.list.map((s) => (
                      <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                        <span className="font-mono">{s.pattern}</span>
                        {s.client_id == null && (
                          <span className="chip bg-surface-2 border border-line text-muted">{t("mail.everyClient")}</span>
                        )}
                        {s.note && <span className="text-xs text-muted">{s.note}</span>}
                        <button className="ml-auto text-xs text-danger underline underline-offset-2"
                          disabled={busy} onClick={() => removeSender(s.id)}>
                          {t("mail.removeSender")}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {msg && <p className={`mt-3 text-sm ${msg.error ? "text-danger" : "text-brand-700"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
