"use client";

/**
 * As formas de LANÇAR venda, todas atrás de um botão.
 *
 * Antes elas ocupavam o corpo da tela: uma grade de cinco linhas vazias em
 * cima e as vendas já lançadas lá no fim, depois de rolar. A tela abria
 * pedindo digitação quando a pergunta do dia a dia é "o que já entrou?".
 *
 * As quatro portas dividem a mesma grade de conferência de propósito — vindo
 * de planilha, de foto ou digitada, a venda passa pelos mesmos olhos antes de
 * virar débito de IVA. Do lado da venda o erro SOBE o imposto a pagar, então
 * nada entra sem alguém ver.
 */

import { useMemo, useRef, useState } from "react";
import { fileToRows } from "@/lib/sheet";

function normDate(v: any): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) { let [, d, mo, y] = m; if (y.length === 2) y = "20" + y; return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`; }
  return s;
}
function cleanNum(s: string): string {
  return String(s ?? "").replace(/[^0-9.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
}
const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v.replace(",", ".")) || 0);
const money = (n: number) => n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Draft = { entry_date: string; doc_number: string; customer: string; net: string; rate: string };
const blank = (): Draft => ({ entry_date: "", doc_number: "", customer: "", net: "", rate: "23" });
const vatOf = (d: Draft) => {
  const net = numOrNull(d.net), rate = numOrNull(d.rate);
  return net != null && rate != null ? (net * rate) / 100 : 0;
};

type Tab = "manual" | "file" | "paste" | "photo";

export default function SalesEntryDialog({
  clientId, onClose, onSaved,
}: {
  clientId: string;
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("manual");
  const [drafts, setDrafts] = useState<Draft[]>(Array.from({ length: 3 }, blank));
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const ready = drafts.filter((d) => d.entry_date && d.net);
  const totalVat = useMemo(() => ready.reduce((a, d) => a + vatOf(d), 0), [drafts]);
  const totalNet = useMemo(() => ready.reduce((a, d) => a + (numOrNull(d.net) ?? 0), 0), [drafts]);

  function setDraft(i: number, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  }
  /** Junta o que foi lido às linhas já preenchidas, sem apagar trabalho. */
  function appendRows(rows: Draft[]) {
    setDrafts((prev) => [...prev.filter((d) => d.entry_date || d.net), ...rows]);
    setTab("manual");
  }

  function importPaste() {
    const rows: Draft[] = [];
    for (const line of paste.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const p = line.split(/[;,\t]/).map((x) => x.trim());
      if (p.length >= 5) rows.push({ entry_date: normDate(p[0]), doc_number: p[1], customer: p[2], net: cleanNum(p[3]), rate: cleanNum(p[4]) || "23" });
      else if (p.length >= 3) rows.push({ entry_date: normDate(p[0]), doc_number: "", customer: "", net: cleanNum(p[1]), rate: cleanNum(p[2]) || "23" });
      else if (p.length === 2) rows.push({ entry_date: normDate(p[0]), doc_number: "", customer: "", net: cleanNum(p[1]), rate: "23" });
    }
    if (!rows.length) { setMsg({ text: "Nenhuma linha reconhecida no texto colado.", error: true }); return; }
    appendRows(rows); setPaste(""); setMsg({ text: `${rows.length} linha(s) lidas — confira antes de gravar.` });
  }

  /** Cabeçalho reconhecido por palavra-chave; sem ele, lê por posição. */
  function parseRows(aoa: any[][]): Draft[] {
    if (!aoa.length) return [];
    const norm = (s: any) => String(s ?? "").toLowerCase().trim();
    const header = (aoa[0] || []).map(norm);
    const find = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
    const hdrKeywords = ["date", "data", "net", "líquido", "liquido", "amount", "valor", "vat", "iva", "rate", "aliquota", "alíquota", "customer", "cliente", "doc", "invoice", "ref", "taxa", "%"];
    const hasHeader = header.some((h) => hdrKeywords.some((n) => h.includes(n)));
    const idx = hasHeader ? {
      date: find("date", "data"),
      doc: find("doc", "invoice", "fatura", "ref", "number", "nº", "no"),
      customer: find("customer", "cliente", "client", "nome", "name"),
      net: find("net", "líquido", "liquido", "amount", "valor", "subtotal", "base"),
      rate: find("rate", "aliquota", "alíquota", "taxa", "vat %", "vat%", "%"),
      vat: find("vat amount", "iva", "imposto", "vat €", "vat value", "tax"),
    } : null;
    const rows = hasHeader ? aoa.slice(1) : aoa;
    const out: Draft[] = [];
    for (const r of rows) {
      if (!r || r.every((c: any) => String(c ?? "").trim() === "")) continue;
      let entry_date = "", doc = "", customer = "", net = "", rate = "23";
      if (idx) {
        const g = (i: number) => (i >= 0 ? r[i] : "");
        entry_date = normDate(g(idx.date));
        doc = String(g(idx.doc) ?? "").trim();
        customer = String(g(idx.customer) ?? "").trim();
        net = cleanNum(String(g(idx.net) ?? ""));
        const rr = cleanNum(String(g(idx.rate) ?? "")); if (rr) rate = rr;
        const vat = cleanNum(String(g(idx.vat) ?? ""));
        // Planilha que traz só o IVA: o líquido sai da própria aritmética dela,
        // não de um palpite.
        if (!net && vat && rate) { const v = parseFloat(vat), rt = parseFloat(rate); if (v && rt) net = (v / rt * 100).toFixed(2); }
      } else {
        const p = r.map((x: any) => String(x ?? "").trim());
        if (p.length >= 5) { entry_date = normDate(p[0]); doc = p[1]; customer = p[2]; net = cleanNum(p[3]); rate = cleanNum(p[4]) || "23"; }
        else if (p.length >= 3) { entry_date = normDate(p[0]); net = cleanNum(p[1]); rate = cleanNum(p[2]) || "23"; }
        else if (p.length === 2) { entry_date = normDate(p[0]); net = cleanNum(p[1]); }
      }
      if (entry_date || net) out.push({ entry_date, doc_number: doc, customer, net, rate });
    }
    return out;
  }

  async function onFile(file: File) {
    setImporting(true); setMsg(null);
    try {
      // Ler o arquivo em células é o mesmo trabalho aqui e na importação de
      // extrato, então mora em lib/sheet.ts. O que as colunas SIGNIFICAM é o
      // que difere, e isso fica em parseRows.
      const { rows: aoa } = await fileToRows(file);
      const parsed = parseRows(aoa as any[][]);
      if (!parsed.length) { setMsg({ text: "Nenhuma linha reconhecida. Confira se há colunas de data e valor.", error: true }); return; }
      appendRows(parsed);
      setMsg({ text: `${parsed.length} linha(s) de ${file.name} — confira antes de gravar.` });
    } catch (e: any) {
      setMsg({ text: "Não foi possível ler o arquivo: " + (e?.message || "erro desconhecido"), error: true });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onSheetPhoto(file: File) {
    setImporting(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/clients/${clientId}/sales/read-sheet`, { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) { setMsg({ text: d.error || "Falha ao ler a planilha.", error: true }); return; }
      const rows: Draft[] = (d.rows || []).map((r: any) => ({
        entry_date: r.entry_date || "",
        doc_number: r.doc_number || "",
        customer: r.customer || "",
        net: r.net_amount != null ? String(r.net_amount) : "",
        rate: r.vat_rate != null ? String(r.vat_rate) : "23",
      }));
      if (!rows.length) { setMsg({ text: "Nenhuma linha de venda reconhecida nesta imagem.", error: true }); return; }
      appendRows(rows);
      const semData = rows.filter((r) => !r.entry_date).length;
      setMsg({
        text: `${rows.length} linha(s) lidas da foto.` + (semData ? ` ${semData} sem data — preencha antes de gravar.` : ""),
        error: semData > 0,
      });
    } catch (e: any) {
      setMsg({ text: "Não foi possível ler a foto: " + (e?.message || "erro desconhecido"), error: true });
    } finally {
      setImporting(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  }

  async function save() {
    if (!ready.length) { setMsg({ text: "Preencha ao menos data e valor líquido.", error: true }); return; }
    setSaving(true);
    try {
      const rows = ready.map((d) => ({
        entry_date: d.entry_date, doc_number: d.doc_number || null, customer: d.customer || null,
        net_amount: numOrNull(d.net), vat_rate: numOrNull(d.rate),
      }));
      const res = await fetch(`/api/clients/${clientId}/sales`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }),
      });
      const d = await res.json();
      // O T1 das obrigações vem das vendas: sem este refresh o VAT3 continua
      // mostrando o número de antes até alguém abrir a tela e recalcular.
      await fetch(`/api/clients/${clientId}/obligations?refresh=1`);
      onSaved(d.count ?? rows.length);
    } finally { setSaving(false); }
  }

  const TABS: { k: Tab; label: string }[] = [
    { k: "manual", label: "Digitar" },
    { k: "file", label: "Excel / CSV" },
    { k: "paste", label: "Colar" },
    { k: "photo", label: "Foto (IA)" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-wrap items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label="Lançar vendas"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <h2 className="font-display text-lg font-semibold">Lançar vendas</h2>
          <span className="text-xs text-muted">débito de IVA (T1)</span>
          <button className="btn-ghost ml-auto h-8 px-3 text-sm" onClick={onClose} aria-label="Fechar">Fechar</button>
        </div>

        {/* As portas de entrada. Todas desembocam na mesma grade abaixo. */}
        <div className="flex gap-1 border-b border-line px-5 py-2">
          {TABS.map((x) => (
            <button
              key={x.k}
              className={`subnav-item h-8 text-xs ${tab === x.k ? "subnav-item-active" : ""}`}
              onClick={() => setTab(x.k)}
            >
              {x.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {tab === "file" && (
            <div className="card p-4">
              <p className="text-sm text-muted">
                Planilha ou extrato de vendas. As colunas são reconhecidas sozinhas
                (data, documento, cliente, líquido, alíquota, IVA).
              </p>
              <button className="btn-primary mt-3 h-9 px-4 text-sm" onClick={() => fileRef.current?.click()} disabled={importing}>
                {importing ? "Lendo…" : "Escolher arquivo"}
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </div>
          )}

          {tab === "paste" && (
            <div className="card p-4">
              <p className="text-sm text-muted">
                Uma venda por linha: <code className="font-mono text-xs">data;documento;cliente;líquido;alíquota</code>
              </p>
              <textarea
                className="input mt-3 h-28 w-full font-mono text-xs" value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder="2026-08-14;SV-103;Cafe Central;260;23"
              />
              <button className="btn-ghost mt-2 h-9 px-4 text-sm" onClick={importPaste}>Passar para a grade</button>
            </div>
          )}

          {tab === "photo" && (
            <div className="card p-4">
              <p className="text-sm text-muted">
                Foto ou PDF de uma folha com <strong>várias</strong> vendas. Cada linha da folha
                vira uma linha da grade, para conferência — a leitura de folha manuscrita erra,
                e do lado da venda o erro sobe o imposto a pagar.
              </p>
              <button className="btn-primary mt-3 h-9 px-4 text-sm" onClick={() => photoRef.current?.click()} disabled={importing}>
                {importing ? "Lendo…" : "Enviar foto"}
              </button>
              <input ref={photoRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden"
                onChange={(e) => e.target.files?.[0] && onSheetPhoto(e.target.files[0])} />
            </div>
          )}

          {msg && (
            <p className={`mt-3 text-sm ${msg.error ? "text-danger" : "text-brand-700"}`}>{msg.text}</p>
          )}

          {/* A grade de conferência — comum às quatro portas. */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                  <th className="py-2 pr-2 font-medium">Data *</th>
                  <th className="py-2 pr-2 font-medium">Documento</th>
                  <th className="py-2 pr-2 font-medium">Cliente</th>
                  <th className="py-2 pr-2 text-right font-medium">Líquido € *</th>
                  <th className="py-2 pr-2 text-right font-medium">Alíq. %</th>
                  <th className="py-2 text-right font-medium">IVA €</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d, i) => (
                  <tr key={i} className="border-b border-line/60">
                    <td className="py-1 pr-2"><input type="date" className="input h-8 w-36 text-xs" value={d.entry_date} onChange={(e) => setDraft(i, { entry_date: e.target.value })} /></td>
                    <td className="py-1 pr-2"><input className="input h-8 w-28 text-xs" value={d.doc_number} onChange={(e) => setDraft(i, { doc_number: e.target.value })} /></td>
                    <td className="py-1 pr-2"><input className="input h-8 w-44 text-xs" value={d.customer} onChange={(e) => setDraft(i, { customer: e.target.value })} /></td>
                    <td className="py-1 pr-2"><input className="input h-8 w-28 text-right text-xs tnum" value={d.net} onChange={(e) => setDraft(i, { net: e.target.value })} /></td>
                    <td className="py-1 pr-2"><input className="input h-8 w-20 text-right text-xs tnum" value={d.rate} onChange={(e) => setDraft(i, { rate: e.target.value })} /></td>
                    <td className="py-1 text-right text-xs tnum text-muted">{money(vatOf(d))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn-ghost mt-2 h-8 px-3 text-xs" onClick={() => setDrafts((p) => [...p, blank()])}>
            + Linha
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
          <span className="text-sm text-muted">
            {ready.length} pronta(s) · líquido <b className="tnum text-ink">€ {money(totalNet)}</b>
            {" · "}IVA <b className="tnum text-ink">€ {money(totalVat)}</b>
          </span>
          <button className="btn-primary ml-auto h-9 px-4 text-sm" onClick={save} disabled={saving || !ready.length}>
            {saving ? "Gravando…" : `Gravar ${ready.length || ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
