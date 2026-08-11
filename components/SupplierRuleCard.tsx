"use client";

/**
 * Uma regra de fornecedor, editável no lugar (camada B1).
 *
 * O resumo fechado diz as duas coisas que importam antes de abrir: **como o
 * fornecedor é reconhecido** e **o que a regra decide**. Uma regra que não
 * decide nada é o erro silencioso desta tela — está cadastrada, casa com o
 * fornecedor, e não muda nada na nota — então o resumo diz isso com essas
 * palavras em vez de mostrar campos vazios.
 */

import { useState } from "react";
import type { SupplierRule } from "@/lib/supplierRules";
import { useT } from "@/lib/i18n";

export default function SupplierRuleCard({
  rule, accounts, categories, busy, onSave, onDelete,
}: {
  rule: SupplierRule;
  accounts: { code: string; description: string }[];
  categories: { code: string; description: string; vat_rate: number }[];
  busy: boolean;
  onSave: (id: string, patch: Partial<SupplierRule>) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SupplierRule>(rule);

  const set = (patch: Partial<SupplierRule>) => setDraft((d) => ({ ...d, ...patch }));

  const cat = categories.find((c) => c.code === draft.vat_category_code);
  const decides = [
    draft.account_code ? t("supCard.accountIs", { code: draft.account_code }) : null,
    cat ? `${cat.description} (${cat.vat_rate}%)` : null,
    draft.extract_line_items === false ? t("supCard.oneLine") : null,
  ].filter(Boolean);

  const recognizes = [
    draft.supplier_vat ? t("supCard.vatIs", { value: draft.supplier_vat }) : null,
    draft.name_match ? t("supCard.nameContains", { value: draft.name_match }) : null,
  ].filter(Boolean);

  return (
    <div className={`card p-4 ${draft.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{draft.label}</p>
          <p className="mt-0.5 text-sm text-muted">
            {recognizes.length ? recognizes.join(" / ") : t("supCard.noIdentifier")}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {decides.length
              ? decides.join(" · ")
              : t("supCard.decidesNothing")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted">
            <input type="checkbox" checked={draft.active}
              onChange={(e) => { set({ active: e.target.checked }); onSave(rule.id, { active: e.target.checked }); }} />
            {t("supCard.active")}
          </label>
          <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setOpen((v) => !v)}>
            {open ? t("common.close") : t("common.edit")}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t("supCard.ruleName")}</span>
            <input className="input h-9" value={draft.label} onChange={(e) => set({ label: e.target.value })} />
          </label>

          <div>
            <p className="label mb-2">{t("supCard.howToMatch")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-muted">{t("supCard.vatNumber")}</span>
                <input className="input h-9 font-mono" placeholder="IE1234567X"
                  value={draft.supplier_vat ?? ""}
                  onChange={(e) => set({ supplier_vat: e.target.value || null })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">{t("supCard.namePart")}</span>
                <input className="input h-9" placeholder="vodafone"
                  value={draft.name_match ?? ""}
                  onChange={(e) => set({ name_match: e.target.value || null })} />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted">
              {t("supCard.matchHelp")}
            </p>
          </div>

          <div>
            <p className="label mb-2">{t("supCard.whatItDecides")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-muted">{t("supCard.ledgerAccount")}</span>
                <select className="input h-9" value={draft.account_code ?? ""}
                  onChange={(e) => {
                    const code = e.target.value || null;
                    const a = accounts.find((x) => x.code === code);
                    set({ account_code: code, account_name: a?.description ?? null });
                  }}>
                  <option value="">{t("supCard.decidesNot")}</option>
                  {accounts.map((a) => (
                    <option key={a.code} value={a.code}>{a.code} · {a.description}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">{t("supCard.vatCategory")}</span>
                <select className="input h-9" value={draft.vat_category_code ?? ""}
                  onChange={(e) => set({ vat_category_code: e.target.value || null })}>
                  <option value="">{t("supCard.decidesNot")}</option>
                  {categories.map((c) => (
                    <option key={c.code} value={c.code}>{c.description} · {c.vat_rate}%</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-2 text-xs text-muted">
              {t("supCard.emptyHelp")}
            </p>
            {draft.vat_category_code && (
              <p className="mt-2 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning">
                {t("supCard.categoryWarn")}
              </p>
            )}
          </div>

          <div>
            <p className="label mb-2">{t("supCard.lineItems")}</p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={draft.extract_line_items !== false}
                onChange={(e) => set({ extract_line_items: e.target.checked })} />
              <span>
                {t("supCard.itemByItem")}
                <span className="mt-0.5 block text-xs text-muted">
                  {t("supCard.lineItemsHelp")}
                </span>
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary h-9 px-4 text-sm" disabled={busy}
              onClick={() => { onSave(rule.id, draft); setOpen(false); }}>{t("common.save")}</button>
            <button className="btn-ghost h-9 px-3 text-sm" onClick={() => { setDraft(rule); setOpen(false); }}>{t("common.cancel")}</button>
            <button className="btn-ghost ml-auto h-9 px-3 text-sm text-danger" disabled={busy}
              onClick={() => onDelete(rule.id)}>{t("supCard.deleteRule")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
