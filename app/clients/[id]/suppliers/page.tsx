"use client";

/**
 * Regras de fornecedor (camada B1).
 *
 * O que esta tela existe para tornar visível é a PRECEDÊNCIA. O sistema já
 * decidia conta e categoria em dois lugares — a escolha do contador na nota e o
 * que ele fez em notas anteriores — e nenhum dos dois estava escrito em lugar
 * nenhum. Uma regra que "não funciona" quase sempre é uma regra que funciona e
 * está sendo sobreposta, ou que está sobrepondo. Por isso a ordem aparece no
 * topo, numerada, antes de qualquer campo.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SupplierRuleCard from "@/components/SupplierRuleCard";
import type { SupplierRule } from "@/lib/supplierRules";
import type { ChartAccount, VatCategory } from "@/lib/types";
import { useT } from "@/lib/i18n";

export default function SupplierRules({ params }: { params: { id: string } }) {
  const { t } = useT();
  const [rules, setRules] = useState<SupplierRule[]>([]);
  const [accounts, setAccounts] = useState<{ code: string; description: string }[]>([]);
  const [categories, setCategories] = useState<{ code: string; description: string; vat_rate: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [vat, setVat] = useState("");
  const [nameMatch, setNameMatch] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    const [r, a, b] = await Promise.all([
      fetch(`/api/clients/${params.id}/supplier-rules`, { cache: "no-store" }),
      fetch(`/api/clients/${params.id}/accounts`, { cache: "no-store" }),
      fetch("/api/base", { cache: "no-store" }),
    ]);
    setRules((await r.json()).rules || []);
    setAccounts(((await a.json()).accounts || []).map((x: ChartAccount) => ({ code: x.code, description: x.description })));
    setCategories(
      ((await b.json()).categories || [])
        .filter((c: VatCategory) => c.active && c.code)
        .map((c: VatCategory) => ({ code: c.code as string, description: c.description, vat_rate: c.vat_rate }))
    );
    setLoading(false);
  }, [params.id]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!label.trim()) { setMsg({ text: t("sup.needName"), error: true }); return; }
    if (!vat.trim() && !nameMatch.trim()) {
      setMsg({ text: t("sup.needIdentifier"), error: true });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${params.id}/supplier-rules`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, supplier_vat: vat, name_match: nameMatch }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ text: d.error || t("sup.error"), error: true }); return; }
      setLabel(""); setVat(""); setNameMatch("");
      setMsg({ text: t("sup.created") });
      await load();
    } finally { setBusy(false); }
  }

  async function save(id: string, patch: Partial<SupplierRule>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${params.id}/supplier-rules/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      setMsg(res.ok ? { text: t("sup.saved") } : { text: d.error || t("sup.error"), error: true });
      await load();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm(t("sup.deleteConfirm"))) return;
    setBusy(true);
    try {
      await fetch(`/api/clients/${params.id}/supplier-rules/${id}`, { method: "DELETE" });
      await load();
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="font-display text-xl font-semibold tracking-tight">{t("sup.title")}</h1>
        <p className="mt-1 text-muted">{t("sup.subtitle")}</p>
      </div>

      <div className="card rise p-5">
        <p className="label mb-2">{t("sup.orderTitle")}</p>
        <ol className="space-y-2 text-sm">
          <li className="flex gap-3">
            <span className="chip bg-ink text-paper shrink-0">1</span>
            <span>
              <strong>{t("sup.order1Strong")}</strong> {t("sup.order1")}
            </span>
          </li>
          <li className="flex gap-3">
            <span className="chip bg-brand text-white shrink-0">2</span>
            <span>
              <strong>{t("sup.order2Strong")}</strong> {t("sup.order2")}
            </span>
          </li>
          <li className="flex gap-3">
            <span className="chip bg-surface-2 border border-line text-muted shrink-0">3</span>
            <span>
              <strong>{t("sup.order3Strong")}</strong> {t("sup.order3")}
            </span>
          </li>
        </ol>
      </div>

      <div className="card rise p-4">
        <p className="label mb-2">{t("sup.newRule")}</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_180px_auto]">
          <input className="input" placeholder={t("sup.namePlaceholder")}
            value={label} onChange={(e) => setLabel(e.target.value)} />
          <input className="input font-mono" placeholder={t("sup.vatPlaceholder")}
            value={vat} onChange={(e) => setVat(e.target.value)} />
          <input className="input" placeholder={t("sup.matchPlaceholder")}
            value={nameMatch} onChange={(e) => setNameMatch(e.target.value)} />
          <button className="btn-primary" onClick={create} disabled={busy}>{t("common.create")}</button>
        </div>
        <p className="mt-2 text-xs text-muted">
          {t("sup.newHelp")}
        </p>
        {msg && (
          <p className={`mt-2 text-sm ${msg.error ? "text-danger" : "text-brand-700"}`}>{msg.text}</p>
        )}
      </div>

      {loading ? (
        <p className="card p-6 text-muted">{t("common.loading")}</p>
      ) : !rules.length ? (
        <p className="card p-6 text-muted">
          {t("sup.empty")}
        </p>
      ) : (
        <div className="space-y-3">
          {rules.map((r) => (
            <SupplierRuleCard key={r.id} rule={r} accounts={accounts} categories={categories}
              busy={busy} onSave={save} onDelete={remove} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted">
        {t("sup.conflictNote")}
      </p>

      {!accounts.length && !loading && (
        <p className="text-xs text-muted">
          {t("sup.noAccountsPre")}{" "}
          <Link href={`/clients/${params.id}/accounts`} className="text-brand-700">{t("sup.noAccountsLink")}</Link>{" "}
          {t("sup.noAccountsPost")}
        </p>
      )}
    </div>
  );
}
