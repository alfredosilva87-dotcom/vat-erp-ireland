"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { StoredInvoice, StoredItem, ChartAccount, Branch } from "@/lib/types";
import { computeLines } from "@/lib/vat";
import { isCategoryUnrelated } from "@/lib/matching";
import InvoiceHistory from "@/components/InvoiceHistory";
import { usePublishClientScope } from "@/components/ClientScope";
import type { AuditEntry, InvoiceDocument } from "@/lib/reviewStore";

type Cat = { code: string | null; description: string; vat_rate: number };

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const numOrNull = (v: string): number | null => {
  if (v.trim() === "") return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * Controlled number input that keeps whatever the user is typing (including a
 * trailing "." or trailing zeros) instead of re-deriving its text from the
 * parsed number on every keystroke — otherwise typing "100." collapses back
 * to "100" before the next digit lands, and a decimal point can never be typed.
 */
function NumInput({ value, onChange, className, placeholder }: {
  value: number | null; onChange: (v: number | null) => void; className?: string; placeholder?: string;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value == null ? "" : String(value));
  }, [value]);
  return (
    <input
      className={className}
      placeholder={placeholder}
      value={text}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setText(value == null ? "" : String(value)); }}
      onChange={(e) => { setText(e.target.value); onChange(numOrNull(e.target.value)); }}
    />
  );
}

export default function InvoiceEdit({ params }: { params: { id: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Where "Database" / post-delete should return to — the screen this
  // invoice was opened from (client's Purchases/Sales tab, Database, ...),
  // instead of always landing back on the global Database list.
  const backTo = searchParams.get("from") || "/records";
  // Quando "from" é uma lista filtrada por lote (?ids=a,b,c — ver "Revisar
  // este lote" na Caixa de entrada / Analisar), dá pra andar pelos documentos
  // do lote sem sair pra lista a cada um. Sem isso, abrir um documento do
  // lote e voltar largava a pessoa na lista inteira, sem o filtro.
  const batchIds = useMemo(() => {
    try {
      const idsParam = new URL(backTo, "http://x").searchParams.get("ids");
      const ids = idsParam ? idsParam.split(",").filter(Boolean) : [];
      return ids.length > 1 ? ids : null;
    } catch {
      return null;
    }
  }, [backTo]);
  const batchIdx = batchIds ? batchIds.indexOf(params.id) : -1;
  const prevId = batchIds && batchIdx > 0 ? batchIds[batchIdx - 1] : null;
  const nextId = batchIds && batchIdx >= 0 && batchIdx < batchIds.length - 1 ? batchIds[batchIdx + 1] : null;
  const navHref = (id: string) => `/invoice/${id}?from=${encodeURIComponent(backTo)}`;
  const [inv, setInv] = useState<StoredInvoice | null>(null);
  /*
   * Diz ao menu lateral de que cliente esta nota é, para ele mostrar o menu do
   * MÓDULO em vez do menu geral — a nota é dado de um cliente, mas a rota
   * (`/invoice/<id>`) não conta isso a ninguém.
   *
   * O `from` vem junto com o clique, então o menu certo já sai no primeiro
   * quadro; o `client_id` da nota entra depois e cobre quem colou a URL ou
   * abriu por favorito, onde não há `from`.
   */
  const clientFromBackTo = backTo.match(/^\/clients\/([^/?#]+)/)?.[1] ?? null;
  const scopedClientId = clientFromBackTo ?? inv?.client_id ?? null;
  usePublishClientScope(scopedClientId);
  const [items, setItems] = useState<StoredItem[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [relatedCategories, setRelatedCategories] = useState<string[]>([]);
  // Trilha e documentos vêm no mesmo GET da nota (camada B3).
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [documents, setDocuments] = useState<InvoiceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/invoices/${params.id}`).then((r) => r.json()).then((d) => {
      setInv(d.invoice || null);
      setItems(d.items || []);
      setAudit(d.audit || []);
      setDocuments(d.documents || []);
    }).finally(() => setLoading(false));
    fetch("/api/base").then((r) => r.json()).then((d) => setCats(d.categories || []));
  }, [params.id]);

  useEffect(() => {
    if (!inv?.client_id) { setAccounts([]); setBranches([]); setRelatedCategories([]); return; }
    fetch(`/api/clients/${inv.client_id}/accounts`).then((r) => r.json()).then((d) => setAccounts(d.accounts || []));
    fetch(`/api/clients/${inv.client_id}/branches`).then((r) => r.json()).then((d) => setBranches(d.branches || []));
    fetch(`/api/clients/${inv.client_id}`).then((r) => r.json()).then((d) => setRelatedCategories(d.client?.related_categories || []));
  }, [inv?.client_id]);

  function setHdr<K extends keyof StoredInvoice>(k: K, v: StoredInvoice[K]) {
    setInv((prev) => (prev ? { ...prev, [k]: v } : prev));
    setDirty(true);
    setMsg(null);
  }
  function setItem(id: string, patch: Partial<StoredItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    setDirty(true);
    setMsg(null);
  }
  function pickCategory(id: string, code: string) {
    const c = cats.find((x) => (x.code || "") === code);
    if (!c) return;
    setItem(id, { category_code: c.code, category_name: c.description, expected_vat_rate: c.vat_rate });
  }
  function pickAccount(id: string, code: string) {
    if (!code) { setItem(id, { account_code: null, account_name: null }); return; }
    const a = accounts.find((x) => x.code === code);
    setItem(id, { account_code: code, account_name: a?.description ?? null });
  }
  function setAll(v: boolean) {
    setItems((prev) => prev.map((it) => ({ ...it, take_credit: v })));
    setDirty(true);
  }

  // Compensates for a page/item missing from the read (e.g. a supplier PDF
  // cut short) — an extra line the accountant fills in by hand, on the same
  // gross-inclusive basis as everything else, instead of a special wizard.
  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        invoice_id: inv?.id || "",
        master_item_id: "",
        description: "",
        quantity: null,
        unit_price: null,
        net_amount: null,
        vat_rate_on_invoice: null,
        vat_amount_on_invoice: null,
        expected_vat_rate: null,
        category_code: null,
        category_name: null,
        account_code: null,
        account_name: null,
        take_credit: false,
        credit_value: 0,
      },
    ]);
    setDirty(true);
  }
  function removeDraftItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setDirty(true);
  }

  const unrelatedCount = useMemo(
    () => items.filter((it) => isCategoryUnrelated(it.category_code, relatedCategories)).length,
    [items, relatedCategories]
  );
  const computed = useMemo(() => computeLines(items, {
    total_net: inv?.total_net ?? null, total_vat: inv?.total_vat ?? null, total_gross: inv?.total_gross ?? null,
  }), [items, inv]);
  const credits = useMemo(() => items.map((it, i) => (it.take_credit ? computed.lines[i].vat : 0)), [items, computed]);
  const totalCredit = useMemo(() => credits.reduce((a, v) => a + v, 0), [credits]);

  async function save() {
    if (!inv) return;
    setSaving(true);
    try {
      const header = {
        supplier_name: inv.supplier_name, store_name: inv.store_name, supplier_vat: inv.supplier_vat,
        invoice_number: inv.invoice_number, barcode: inv.barcode, invoice_date: inv.invoice_date,
        posting_date: inv.posting_date, invoice_time: inv.invoice_time, doc_type: inv.doc_type,
        branch_id: inv.branch_id,
        total_net: inv.total_net, total_vat: inv.total_vat, total_gross: inv.total_gross,
      };
      const payloadItems = items.map((it) => ({
        id: it.id, description: it.description, quantity: it.quantity, unit_price: it.unit_price, net_amount: it.net_amount,
        vat_rate_on_invoice: it.vat_rate_on_invoice, expected_vat_rate: it.expected_vat_rate,
        category_code: it.category_code, category_name: it.category_name,
        account_code: it.account_code, account_name: it.account_name, take_credit: it.take_credit,
      }));
      const res = await fetch(`/api/invoices/${params.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ header, items: payloadItems }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed.");
      setInv(d.invoice); setItems(d.items); setDirty(false); setMsg("Changes saved.");
      // A trilha acabou de crescer com esta gravação; buscar de novo é o que faz
      // o histórico aparecer sem recarregar a página.
      await refreshHistory();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this invoice and its document permanently?")) return;
    await fetch(`/api/invoices/${params.id}`, { method: "DELETE" });
    router.push(backTo);
  }

  async function refreshHistory() {
    const d = await (await fetch(`/api/invoices/${params.id}`, { cache: "no-store" })).json();
    setAudit(d.audit || []);
    setDocuments(d.documents || []);
    return d;
  }

  /**
   * Aprovar passa pela mesma rota do lote (camada B3), e não por um PATCH que
   * apagaria `needs_review` sem registrar nada: é assim que a aprovação fica na
   * trilha com nome e hora, em vez de a nota simplesmente parar de pedir revisão.
   */
  async function approve() {
    const res = await fetch("/api/invoices/approve", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [params.id] }),
    });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error || "Erro ao aprovar."); return; }
    const fresh = await refreshHistory();
    setInv(fresh.invoice);
    setMsg("Nota aprovada.");
  }

  async function reopen() {
    if (!confirm("Desfazer a aprovação desta nota? Fica registrado no histórico.")) return;
    const res = await fetch(`/api/invoices/${params.id}/reopen`, { method: "POST" });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error || "Só administrador pode desfazer uma aprovação."); return; }
    const fresh = await refreshHistory();
    setInv(fresh.invoice);
    setMsg("Aprovação desfeita.");
  }

  if (loading) return <p className="text-muted">Loading…</p>;
  if (!inv) return <p className="text-muted">Invoice not found. <Link href={backTo} className="text-brand">Back</Link></p>;

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={backTo} className="text-sm text-brand">
            {batchIds ? `← Back to batch (${batchIds.length})` : "← Back"}
          </Link>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Edit invoice</h1>
          {inv.client_name && (
            <p className="mt-1 text-sm text-brand-700 font-medium">{inv.client_code} · {inv.client_name}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {inv.document_file && (
            <a className="btn-ghost" href={`/api/invoices/${inv.id}/document`} target="_blank" rel="noreferrer">View document</a>
          )}
          <button className="btn-ghost text-danger" onClick={remove}>Delete</button>
          {msg && <span className="text-sm text-muted">{msg}</span>}
          <button className="btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {/*
        Barra de "andar pelo lote": só aparece vindo de uma lista filtrada por
        ?ids= com mais de um documento — o caso de "Revisar este lote". Sem
        isso, ver os documentos um a um era: voltar pra lista, achar o
        próximo, abrir de novo — a cada nota.
      */}
      {batchIds && (
        <div className="card flex items-center justify-between gap-3 p-3">
          {/*
            No PRIMEIRO documento o "anterior" não some: volta para a lista.
            Um botão que desaparece na primeira posição faz a pessoa procurar
            onde clicar para sair, e o gesto de "voltar" já está ali.
          */}
          {prevId ? (
            <Link href={navHref(prevId)} className="btn-ghost h-9 px-3 text-sm">← Anterior</Link>
          ) : (
            <Link href={backTo} className="btn-ghost h-9 px-3 text-sm">← Voltar à lista</Link>
          )}
          <span className="text-xs text-muted">
            Documento {batchIdx + 1} de {batchIds.length} neste lote
          </span>
          {nextId ? (
            <Link href={navHref(nextId)} className="btn-ghost h-9 px-3 text-sm">Próximo →</Link>
          ) : (
            <div className="flex items-center gap-2">
              <Link href={backTo} className="btn-ghost h-9 px-3 text-sm">Pronto — voltar ao lote</Link>
              {/*
                Conferidas as entradas, o passo seguinte do fechamento é olhar
                as saídas — e até aqui isso exigia sair pelo menu e procurar.
                Só aparece dentro de um cliente: fora dele não há "as vendas
                deste cliente" para abrir.
              */}
              {scopedClientId && (
                <Link href={`/clients/${scopedClientId}/sales`} className="btn-primary h-9 px-3 text-sm">
                  Conferir vendas →
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {inv.needs_review && (
        <div className="rounded-xl2 border border-warning bg-warning-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-warning">Needs review — the automated read wasn&apos;t fully confident</p>
              {inv.review_notes?.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-sm text-warning">
                  {inv.review_notes.map((note, i) => <li key={i}>{note}</li>)}
                </ul>
              )}
            </div>
            <button className="btn-ghost shrink-0" onClick={approve}>Conferi — aprovar</button>
          </div>
        </div>
      )}

      {inv.reviewed_at ? (
        <div className="rounded-xl2 border border-line bg-surface-2/60 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p>
              <span className="chip-ok mr-2">conferida</span>
              Aprovada por <strong>{inv.reviewed_by_email || "usuário não registrado"}</strong> em{" "}
              <span className="tnum">{inv.reviewed_at.slice(0, 16).replace("T", " ")}</span>
            </p>
            <button className="btn-ghost h-8 shrink-0 px-3 text-xs" onClick={reopen}>
              Desfazer aprovação
            </button>
          </div>
        </div>
      ) : !inv.needs_review ? (
        // A leitura veio confiante, então ninguém foi obrigado a olhar — e é
        // exatamente por isso que vale dizer que ainda não houve conferência.
        // Antes desta camada, "não pede revisão" e "alguém conferiu" eram a mesma
        // tela, e a diferença entre as duas é o que uma auditoria pergunta.
        <div className="rounded-xl2 border border-line bg-surface-2/40 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <p>A leitura veio confiante e <strong>ninguém conferiu ainda</strong>.</p>
            <button className="btn-ghost h-8 shrink-0 px-3 text-xs" onClick={approve}>
              Conferi — aprovar
            </button>
          </div>
        </div>
      ) : null}

      {unrelatedCount > 0 && (
        <div className="rounded-xl2 border border-warning bg-warning-50 p-4">
          <p className="font-medium text-warning">
            {unrelatedCount} item(s) have a category outside {inv.client_name || "this client"}&apos;s registered business categories — verify below.
          </p>
        </div>
      )}

      {/* Header edit */}
      <div className="card p-5">
        <h2 className="font-display text-lg font-semibold">Document details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <F label="Supplier"><input className="input" value={inv.supplier_name || ""} onChange={(e) => setHdr("supplier_name", e.target.value)} /></F>
          <F label="Store / branch"><input className="input" value={inv.store_name || ""} onChange={(e) => setHdr("store_name", e.target.value)} placeholder="e.g. Shrewsbury" /></F>
          <F label="VAT number"><input className="input" value={inv.supplier_vat || ""} onChange={(e) => setHdr("supplier_vat", e.target.value)} /></F>
          <F label="Document no."><input className="input" value={inv.invoice_number || ""} onChange={(e) => setHdr("invoice_number", e.target.value)} /></F>
          <F label="Issue date"><input type="date" className="input" value={inv.invoice_date || ""} onChange={(e) => setHdr("invoice_date", e.target.value)} /></F>
          <F label="Posting date"><input type="date" className="input" value={inv.posting_date || ""} onChange={(e) => setHdr("posting_date", e.target.value)} /></F>
          <F label="Time"><input className="input" value={inv.invoice_time || ""} onChange={(e) => setHdr("invoice_time", e.target.value)} placeholder="HH:MM" /></F>
          <F label="Barcode / reference"><input className="input font-mono" value={inv.barcode || ""} onChange={(e) => setHdr("barcode", e.target.value)} /></F>
          <F label="Type">
            <select className="input" value={inv.doc_type} onChange={(e) => setHdr("doc_type", e.target.value)}>
              <option value="invoice">Invoice</option>
              <option value="receipt">Receipt</option>
              <option value="other">Other</option>
            </select>
          </F>
          {branches.length > 0 && (
            <F label="Branch / loja">
              <select className="input" value={inv.branch_id || ""} onChange={(e) => setHdr("branch_id", e.target.value || null)}>
                <option value="">No branch</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.code ? `${b.code} · ` : ""}{b.name}</option>
                ))}
              </select>
            </F>
          )}
          <div className="grid grid-cols-3 gap-2 sm:col-span-2 lg:col-span-1">
            <F label="Net €"><NumInput className="input" value={inv.total_net} onChange={(v) => setHdr("total_net", v)} /></F>
            <F label="VAT €"><NumInput className="input" value={inv.total_vat} onChange={(v) => setHdr("total_vat", v)} /></F>
            <F label="Gross €"><NumInput className="input" value={inv.total_gross} onChange={(v) => setHdr("total_gross", v)} /></F>
          </div>
        </div>
      </div>

      {/* Items edit */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="chip bg-brand text-white">Credit (live) € {money(totalCredit)}</span>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={addItem} title="e.g. a page/item missing from the read — enter the amount as printed and pick a category">+ Add item</button>
          <button className="btn-ghost" onClick={() => setAll(true)}>Credit all</button>
          <button className="btn-ghost" onClick={() => setAll(false)}>Uncredit all</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="whitespace-nowrap px-3 py-3 font-medium">Item</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">Category</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">Account</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium text-right" title="Base rate %">Rate %</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium text-right" title="VAT doc %">VAT %</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium text-right" title="The amount as printed on the document — net or VAT-inclusive gross, depending on how the supplier prints it.">Amount €</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium text-right">Gross €</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium text-right">Net €</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium text-right">Credit €</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium text-center">Credit</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={it.id} className="border-b border-line/70 align-middle">
                  <td className="px-3 py-2 min-w-[240px]">
                    <div className="flex items-center gap-1.5">
                      <input className="input h-9" value={it.description} onChange={(e) => setItem(it.id, { description: e.target.value })} />
                      {isCategoryUnrelated(it.category_code, relatedCategories) && (
                        <span className="chip-warn shrink-0" title="This item's category isn't in the client's registered business categories — verify.">
                          Verify
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select className="input h-9" value={it.category_code || ""} onChange={(e) => pickCategory(it.id, e.target.value)}>
                      <option value="">— uncategorised —</option>
                      {cats.map((c) => (
                        <option key={c.code || c.description} value={c.code || ""}>
                          {c.description} ({c.vat_rate}%)
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {accounts.length > 0 ? (
                      <select className="input h-9 w-24" value={it.account_code || ""} onChange={(e) => pickAccount(it.id, e.target.value)} title={it.account_name || ""}>
                        <option value="">— no account —</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.code}>{a.code} · {a.description}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-muted">no chart</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <NumInput className="input h-9 w-14 text-right" value={it.expected_vat_rate} onChange={(v) => setItem(it.id, { expected_vat_rate: v })} />
                  </td>
                  <td className="px-3 py-2">
                    <NumInput className="input h-9 w-14 text-right" value={it.vat_rate_on_invoice} onChange={(v) => setItem(it.id, { vat_rate_on_invoice: v })} />
                  </td>
                  <td className="px-3 py-2">
                    <NumInput className="input h-9 w-24 text-right" value={it.net_amount} onChange={(v) => setItem(it.id, { net_amount: v })} />
                  </td>
                  <td className="px-3 py-2 text-right tnum">{money((computed.lines[idx]?.net ?? 0) + (computed.lines[idx]?.vat ?? 0))}</td>
                  <td className="px-3 py-2 text-right tnum">{money(computed.lines[idx]?.net)}</td>
                  <td className="px-3 py-2 text-right tnum">{it.take_credit ? money(credits[idx]) : "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => setItem(it.id, { take_credit: !it.take_credit })}
                      role="switch" aria-checked={it.take_credit}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${it.take_credit ? "bg-brand" : "bg-line"}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${it.take_credit ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </td>
                  <td className="px-2 py-2 text-center">
                    {it.id.startsWith("new-") && (
                      <button className="text-xs text-muted hover:text-danger" title="Remove this line" onClick={() => removeDraftItem(it.id)}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <InvoiceHistory
        audit={audit} documents={documents}
        mainDocument={Boolean(inv.document_file)} invoiceId={inv.id}
      />

      <p className="text-xs text-muted">
        Everything here is editable: header fields (including the date), each item&apos;s description,
        category, base rate, the rate on the document, the amount, and the credit decision. Amount is the
        figure as printed on the document (net or VAT-inclusive gross, depending on the supplier) — Gross,
        Net and Credit are calculated from it and always reconcile (Net + VAT = Gross). Picking a
        category fills the base rate; you can still override it. Save changes updates the invoice total
        and the client balance.
      </p>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
