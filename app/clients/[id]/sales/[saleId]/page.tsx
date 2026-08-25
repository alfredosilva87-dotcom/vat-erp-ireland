"use client";

/**
 * Conferir UMA venda, com o documento ao lado.
 *
 * Espelha a revisão da nota de entrada, sem a metade que não existe do lado da
 * venda: não há crédito a decidir nem conta a classificar — venda é débito de
 * IVA (T1), então o que se confere é data, cliente, líquido e alíquota.
 *
 * Mora sob `/clients/[id]/...` de propósito: assim o menu do módulo continua
 * de pé sozinho, sem precisar do ClientScope que a revisão da entrada usa (ela
 * está em `/invoice/[id]`, fora da árvore do cliente, por ser anterior aos
 * módulos).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { SalesEntry, SalesItem } from "@/lib/types";

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numOrNull = (v: string): number | null => {
  if (v.trim() === "") return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export default function SaleReview({ params }: { params: { id: string; saleId: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const backTo = searchParams.get("from") || `/clients/${params.id}/sales`;

  const [sale, setSale] = useState<SalesEntry | null>(null);
  const [items, setItems] = useState<SalesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Andar pelo lote sem voltar à lista a cada venda — mesma ideia da entrada.
  const batchIds = useMemo(() => {
    const raw = searchParams.get("ids");
    const ids = raw ? raw.split(",").filter(Boolean) : [];
    return ids.length > 1 ? ids : null;
  }, [searchParams]);
  const idx = batchIds ? batchIds.indexOf(params.saleId) : -1;
  const prevId = batchIds && idx > 0 ? batchIds[idx - 1] : null;
  const nextId = batchIds && idx >= 0 && idx < batchIds.length - 1 ? batchIds[idx + 1] : null;
  const navHref = (id: string) =>
    `/clients/${params.id}/sales/${id}?from=${encodeURIComponent(backTo)}${batchIds ? `&ids=${batchIds.join(",")}` : ""}`;

  const load = useCallback(async () => {
    setLoading(true);
    const d = await (await fetch(`/api/clients/${params.id}/sales/${params.saleId}`)).json();
    setSale(d.sale || null);
    setItems(d.items || []);
    setLoading(false);
  }, [params.id, params.saleId]);

  useEffect(() => { load(); }, [load]);

  function patch(p: Partial<SalesEntry>) {
    setSale((prev) => (prev ? { ...prev, ...p } : prev));
    setDirty(true);
  }

  async function save() {
    if (!sale) return;
    setSaving(true); setMsg(null);
    try {
      const res = await fetch(`/api/clients/${params.id}/sales/${params.saleId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_date: sale.entry_date, doc_number: sale.doc_number, customer: sale.customer,
          net_amount: sale.net_amount, vat_rate: sale.vat_rate,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Não foi possível salvar."); return; }
      setSale(d.sale); setDirty(false); setMsg("Salvo.");
    } finally { setSaving(false); }
  }

  /**
   * "Conferi" — grava QUEM e QUANDO, não só apaga o alerta.
   *
   * Numa auditoria, "o sistema leu" e "uma pessoa conferiu" são afirmações
   * diferentes, e só a segunda sustenta o número entregue no VAT3.
   */
  async function approve() {
    setMsg(null);
    const res = await fetch(`/api/clients/${params.id}/sales/${params.saleId}/review`, { method: "POST" });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error || "Não foi possível aprovar."); return; }
    setSale(d.sale);
  }

  /** Desfazer a conferência apaga o nome de quem assinou — só administrador. */
  async function reopen() {
    setMsg(null);
    const res = await fetch(`/api/clients/${params.id}/sales/${params.saleId}/review`, { method: "DELETE" });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error || "Só administrador pode desfazer uma conferência."); return; }
    setSale(d.sale);
  }

  async function remove() {
    if (!confirm("Excluir esta venda? O documento guardado também sai.")) return;
    const res = await fetch(`/api/clients/${params.id}/sales/${params.saleId}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json(); setMsg(d.error || "Não foi possível excluir."); return; }
    router.push(backTo);
  }

  if (loading) return <p className="text-muted">Carregando…</p>;
  if (!sale) return <p className="text-muted">Venda não encontrada. <Link href={backTo} className="text-brand">Voltar</Link></p>;

  const gross = (sale.net_amount || 0) + (sale.vat_amount || 0);

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={backTo} className="text-sm text-brand">
            {batchIds ? `← Voltar ao lote (${batchIds.length})` : "← Vendas"}
          </Link>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Conferir venda</h1>
          <p className="mt-1 text-sm text-muted">Débito de IVA (T1) — venda não gera crédito.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sale.document_path && (
            <a className="btn-ghost" href={`/api/clients/${params.id}/sales/${sale.id}/document`} target="_blank" rel="noreferrer">
              Ver documento
            </a>
          )}
          <button className="btn-ghost text-danger" onClick={remove}>Excluir</button>
          {msg && <span className="text-sm text-muted">{msg}</span>}
          <button className="btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </div>

      {/*
        O estado da conferência, sempre visível — é o que responde "posso
        fechar o período?" sem abrir o documento.
      */}
      {sale.reviewed_at ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl2 border border-success/40 bg-success-50 p-4 text-sm text-success">
          <span className="font-medium">Conferida</span>
          <span className="text-xs">
            por {sale.reviewed_by_email || "—"} em {sale.reviewed_at.slice(0, 16).replace("T", " ")}
          </span>
          <button className="btn-ghost ml-auto h-8 px-3 text-xs" onClick={reopen}>Desfazer</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl2 border border-warning bg-warning-50 p-4 text-sm text-warning">
          <div>
            <p className="font-medium">Ainda não conferida.</p>
            {sale.needs_review && (
              <p className="mt-0.5 text-xs">A leitura não veio confiante — confira os valores antes de fechar o período.</p>
            )}
          </div>
          <button className="btn-primary ml-auto h-8 px-3 text-xs" onClick={approve}>Conferi — aprovar</button>
        </div>
      )}

      {batchIds && (
        <div className="card flex items-center justify-between gap-3 p-3">
          {/* Na primeira, "anterior" volta para a lista em vez de sumir. */}
          {prevId
            ? <Link href={navHref(prevId)} className="btn-ghost h-9 px-3 text-sm">← Anterior</Link>
            : <Link href={backTo} className="btn-ghost h-9 px-3 text-sm">← Voltar à lista</Link>}
          <span className="text-xs text-muted">Venda {idx + 1} de {batchIds.length} neste lote</span>
          {nextId
            ? <Link href={navHref(nextId)} className="btn-ghost h-9 px-3 text-sm">Próxima →</Link>
            : (
              <div className="flex items-center gap-2">
                <Link href={backTo} className="btn-ghost h-9 px-3 text-sm">Pronto — voltar ao lote</Link>
                {/* O caminho inverso do lado da entrada: fechadas as saídas, o
                    passo seguinte é conferir as compras do período. */}
                <Link href={`/clients/${params.id}/purchases`} className="btn-primary h-9 px-3 text-sm">
                  Conferir entradas →
                </Link>
              </div>
            )}
        </div>
      )}

      <div className="card p-5">
        <h2 className="font-display text-lg font-semibold">Dados da venda</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">Data *</label>
            <input type="date" className="input" value={sale.entry_date || ""}
              onChange={(e) => patch({ entry_date: e.target.value })} />
          </div>
          <div>
            <label className="label">Número do documento</label>
            <input className="input" value={sale.doc_number || ""}
              onChange={(e) => patch({ doc_number: e.target.value })} />
          </div>
          <div>
            <label className="label">Cliente (comprador)</label>
            <input className="input" value={sale.customer || ""}
              onChange={(e) => patch({ customer: e.target.value })} />
          </div>
          <div>
            <label className="label">Líquido €</label>
            <input className="input text-right" defaultValue={sale.net_amount ?? ""}
              onBlur={(e) => patch({ net_amount: numOrNull(e.target.value) })} />
          </div>
          <div>
            <label className="label">Alíquota %</label>
            <input className="input text-right" defaultValue={sale.vat_rate ?? ""}
              onBlur={(e) => patch({ vat_rate: numOrNull(e.target.value) })} />
          </div>
          <div>
            <label className="label">IVA €</label>
            {/*
              Só leitura: o IVA é recalculado no servidor a partir de líquido ×
              alíquota ao salvar. Deixar editar aqui abriria a porta para o
              número do VAT3 sair da tela em vez do cálculo.
            */}
            <input className="input text-right bg-surface-2" value={money(sale.vat_amount)} readOnly />
          </div>
        </div>
        <p className="mt-3 text-sm text-muted">
          Bruto: <span className="tnum font-semibold text-ink">€ {money(gross)}</span>
          {sale.original_filename ? <> · arquivo: <span className="font-mono text-xs">{sale.original_filename}</span></> : null}
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-line bg-surface-2/60 px-4 py-3 font-medium">Linhas</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-medium">Descrição</th>
              <th className="px-4 py-2 font-medium text-right">Qtd</th>
              <th className="px-4 py-2 font-medium text-right">Líquido €</th>
              <th className="px-4 py-2 font-medium text-right">Alíquota %</th>
              <th className="px-4 py-2 font-medium text-right">IVA €</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-line/70">
                <td className="px-4 py-2">{it.description}</td>
                <td className="px-4 py-2 text-right tnum">{it.quantity ?? "—"}</td>
                <td className="px-4 py-2 text-right tnum">{money(it.net_amount)}</td>
                <td className="px-4 py-2 text-right tnum">{it.vat_rate ?? "—"}</td>
                <td className="px-4 py-2 text-right tnum">{money(it.vat_amount)}</td>
              </tr>
            ))}
            {!items.length && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Sem linhas.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
