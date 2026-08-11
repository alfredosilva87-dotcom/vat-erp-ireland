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
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SupplierRule>(rule);

  const set = (patch: Partial<SupplierRule>) => setDraft((d) => ({ ...d, ...patch }));

  const cat = categories.find((c) => c.code === draft.vat_category_code);
  const decides = [
    draft.account_code ? `conta ${draft.account_code}` : null,
    cat ? `${cat.description} (${cat.vat_rate}%)` : null,
    draft.extract_line_items === false ? "uma linha, sem detalhar itens" : null,
  ].filter(Boolean);

  const recognizes = [
    draft.supplier_vat ? `VAT ${draft.supplier_vat}` : null,
    draft.name_match ? `nome contém “${draft.name_match}”` : null,
  ].filter(Boolean);

  return (
    <div className={`card p-4 ${draft.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{draft.label}</p>
          <p className="mt-0.5 text-sm text-muted">
            {recognizes.length ? recognizes.join(" ou ") : "Sem forma de reconhecer o fornecedor."}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {decides.length
              ? decides.join(" · ")
              : "Não decide nada — esta regra casa com o fornecedor e não muda nada na nota."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted">
            <input type="checkbox" checked={draft.active}
              onChange={(e) => { set({ active: e.target.checked }); onSave(rule.id, { active: e.target.checked }); }} />
            ativa
          </label>
          <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setOpen((v) => !v)}>
            {open ? "Fechar" : "Editar"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Nome da regra</span>
            <input className="input h-9" value={draft.label} onChange={(e) => set({ label: e.target.value })} />
          </label>

          <div>
            <p className="label mb-2">Como reconhecer o fornecedor</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Número de VAT</span>
                <input className="input h-9 font-mono" placeholder="IE1234567X"
                  value={draft.supplier_vat ?? ""}
                  onChange={(e) => set({ supplier_vat: e.target.value || null })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Pedaço do nome</span>
                <input className="input h-9" placeholder="vodafone"
                  value={draft.name_match ?? ""}
                  onChange={(e) => set({ name_match: e.target.value || null })} />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted">
              O número de VAT é o reconhecimento forte: “Tesco Stores”, “TESCO IRELAND LTD” e “Tesco” são o
              mesmo fornecedor com três nomes, mas um número só. O pedaço do nome serve para o fornecedor cuja
              nota não traz VAT — e entre dois nomes que casam, ganha o mais longo, que é o mais específico.
            </p>
          </div>

          <div>
            <p className="label mb-2">O que a regra decide</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Conta contábil</span>
                <select className="input h-9" value={draft.account_code ?? ""}
                  onChange={(e) => {
                    const code = e.target.value || null;
                    const a = accounts.find((x) => x.code === code);
                    set({ account_code: code, account_name: a?.description ?? null });
                  }}>
                  <option value="">— não decide —</option>
                  {accounts.map((a) => (
                    <option key={a.code} value={a.code}>{a.code} · {a.description}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Categoria de VAT</span>
                <select className="input h-9" value={draft.vat_category_code ?? ""}
                  onChange={(e) => set({ vat_category_code: e.target.value || null })}>
                  <option value="">— não decide —</option>
                  {categories.map((c) => (
                    <option key={c.code} value={c.code}>{c.description} · {c.vat_rate}%</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-2 text-xs text-muted">
              Campo em “não decide” fica com quem decidia antes: a memória do sistema ou a IA. É assim que um
              supermercado ganha destino contábil <strong>sem</strong> ter as alíquotas das suas linhas
              (23%, 13,5%, 0%) achatadas num número só.
            </p>
            {draft.vat_category_code && (
              <p className="mt-2 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning">
                A categoria escolhida vale para <strong>todas as linhas</strong> do documento. Certo para quem
                emite sempre a mesma coisa (telecom, aluguel, seguro); errado para quem mistura alíquotas na
                mesma nota — nesse caso deixe em “não decide”.
              </p>
            )}
          </div>

          <div>
            <p className="label mb-2">Itens de linha</p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={draft.extract_line_items !== false}
                onChange={(e) => set({ extract_line_items: e.target.checked })} />
              <span>
                Detalhar item por item
                <span className="mt-0.5 block text-xs text-muted">
                  Desligado, a nota entra como <strong>uma linha</strong> com o total do próprio documento e a
                  classificação por IA não roda. É a economia de tempo e de custo para o fornecedor cujo
                  detalhe ninguém confere — a fatura da luz, o aluguel, a mensalidade.
                </span>
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary h-9 px-4 text-sm" disabled={busy}
              onClick={() => { onSave(rule.id, draft); setOpen(false); }}>Salvar</button>
            <button className="btn-ghost h-9 px-3 text-sm" onClick={() => { setDraft(rule); setOpen(false); }}>Cancelar</button>
            <button className="btn-ghost ml-auto h-9 px-3 text-sm text-danger" disabled={busy}
              onClick={() => onDelete(rule.id)}>Apagar regra</button>
          </div>
        </div>
      )}
    </div>
  );
}
