"use client";

/**
 * Notas de saída (T1) — a lista primeiro.
 *
 * Antes esta tela abria com uma grade de cinco linhas em branco pedindo
 * digitação, e as vendas já lançadas ficavam depois de rolar a página. A
 * pergunta do dia a dia é "o que já entrou neste período?", não "o que quero
 * digitar agora" — então a lista vem primeiro e as quatro formas de lançar
 * moram atrás de um botão (components/SalesEntryDialog.tsx).
 *
 * Mesma forma da tela de Compras: resumo que segue os filtros, filtros com
 * atalhos de período, tabela com realce de linha e acesso ao documento.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ExportPanel from "@/components/ExportPanel";
import SalesEntryDialog from "@/components/SalesEntryDialog";
import { useT } from "@/lib/i18n";
import type { SalesEntry, SalesItem } from "@/lib/types";

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pad = (n: number) => String(n).padStart(2, "0");
const f = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Por onde a venda entrou. `null` é a venda digitada ou vinda de planilha —
 * dizer "manual" é honesto, e diferente de "não registrada".
 */
const originLabel = (s: string | null) =>
  s === "phone" ? "Link de telefone" : s === "email" ? "E-mail" : s === "upload" ? "Arquivo enviado" : "Manual";

export default function SalesPage({ params }: { params: { id: string } }) {
  const { t } = useT();
  const [sales, setSales] = useState<SalesEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  // Detalhe por alíquota, aberto sob demanda — mesma seta da tela de entrada.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [itemsCache, setItemsCache] = useState<Record<string, SalesItem[]>>({});
  const [loadingItems, setLoadingItems] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await (await fetch(`/api/clients/${params.id}/sales`)).json();
      setSales(d.sales || []);
    } finally { setLoading(false); }
  }, [params.id]);
  useEffect(() => { load(); }, [load]);

  /*
   * Filtro no navegador, não no servidor.
   *
   * A lista de vendas de um cliente é curta (dezenas por período, não
   * milhares como as notas de entrada), então filtrar aqui evita uma ida ao
   * banco a cada tecla. Se um dia crescer, isto vira parâmetro na rota.
   */
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sales.filter((s) => {
      if (start && s.entry_date < start) return false;
      if (end && s.entry_date > end) return false;
      if (!needle) return true;
      return [s.doc_number, s.customer].filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [sales, query, start, end]);

  // O resumo acompanha o que está na tela, então segue os filtros.
  const totals = useMemo(() => ({
    count: shown.length,
    net: shown.reduce((a, s) => a + (s.net_amount || 0), 0),
    vat: shown.reduce((a, s) => a + (s.vat_amount || 0), 0),
    // Pendente é o que ninguém assinou — leitura fraca é só um agravante.
    review: shown.filter((s) => !s.reviewed_at).length,
  }), [shown]);

  function preset(k: "month" | "prev" | "year") {
    const now = new Date();
    if (k === "month") {
      setStart(f(new Date(now.getFullYear(), now.getMonth(), 1)));
      setEnd(f(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    } else if (k === "prev") {
      setStart(f(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      setEnd(f(new Date(now.getFullYear(), now.getMonth(), 0)));
    } else {
      setStart(f(new Date(now.getFullYear(), 0, 1)));
      setEnd(f(new Date(now.getFullYear(), 11, 31)));
    }
  }
  const filtersOn = !!(start || end || query);

  async function remove(id: string) {
    if (!confirm("Excluir esta venda? O documento guardado também sai.")) return;
    await fetch(`/api/sales/${id}`, { method: "DELETE" });
    // O T1 do VAT3 vem daqui: sem recalcular, a obrigação segue mostrando o
    // número de antes.
    await fetch(`/api/clients/${params.id}/obligations?refresh=1`);
    load();
  }

  /** Busca as linhas só quando a seta é aberta, e guarda o resultado. */
  async function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    if (!itemsCache[id]) {
      setLoadingItems((prev) => new Set(prev).add(id));
      try {
        const d = await (await fetch(`/api/clients/${params.id}/sales/${id}`)).json();
        setItemsCache((prev) => ({ ...prev, [id]: d.items || [] }));
      } finally {
        setLoadingItems((prev) => { const n = new Set(prev); n.delete(id); return n; });
      }
    }
  }

  /*
   * Líquido por alíquota da venda.
   *
   * A conferência é a mesma da entrada: soma dos líquidos + IVA tem de dar o
   * bruto. É o que denuncia documento mal lido sem precisar abrir a imagem —
   * e do lado da venda um líquido a mais vira imposto a mais a pagar.
   *
   * A alíquota da LINHA manda; sem ela, cai na do cabeçalho. Linha sem
   * nenhuma das duas entra como 0%, que é o honesto: dizer 23% por costume
   * inventaria imposto que o documento não declara.
   */
  function rateBreakdown(sale: SalesEntry, items: SalesItem[]) {
    const byRate = new Map<number, number>();
    for (const it of items) {
      const rate = it.vat_rate ?? sale.vat_rate ?? 0;
      byRate.set(rate, (byRate.get(rate) || 0) + (it.net_amount || 0));
    }
    const rates = Array.from(byRate.entries())
      .map(([rate, net]) => ({ rate, net }))
      .sort((a, b) => b.rate - a.rate);
    const netSum = rates.reduce((a, r) => a + r.net, 0);
    const gross = (sale.net_amount || 0) + (sale.vat_amount || 0);
    const reconciled = Math.abs(netSum + (sale.vat_amount || 0) - gross) <= Math.max(0.05, Math.abs(gross) * 0.02);
    return { rates, reconciled, gross };
  }

  /** Separado por tabulação: cola como linhas no Excel, não como texto. */
  function copyBreakdown(sale: SalesEntry, b: { rates: { rate: number; net: number }[]; gross: number }) {
    navigator.clipboard.writeText([
      `Cliente: ${sale.customer || "—"}`,
      `Doc: ${sale.doc_number || "—"}`,
      `Bruto\t${money(b.gross)}`,
      `IVA\t${money(sale.vat_amount)}`,
      ...b.rates.map((r) => `Líquido ${r.rate}%\t${money(r.net)}`),
    ].join("\n"));
    setCopiedId(sale.id);
    setTimeout(() => setCopiedId((c) => (c === sale.id ? null : c)), 1500);
  }

  const ids = shown.map((s) => s.id).join(",");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">{t("client.tabSales")}</h2>
          <p className="text-sm text-muted">Débito de IVA — venda não gera crédito.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportPanel clientId={params.id} defaultSets={["sales"]} />
          <button className="btn-primary h-9 px-3 text-sm" onClick={() => setDialog(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Lançar vendas
          </button>
        </div>
      </div>

      {msg && <p className="rounded-xl border border-brand/40 bg-brand-50 px-4 py-2.5 text-sm text-brand-700">{msg}</p>}

      {/* Resumo — segue os filtros. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Vendas" value={String(totals.count)} />
        <Stat label="Líquido €" value={money(totals.net)} />
        <Stat label="IVA sobre vendas €" value={money(totals.vat)} strong />
        <Stat label="A conferir" value={String(totals.review)} warn={totals.review > 0} />
      </div>

      {/* Filtros */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label">{t("common.from")}</label>
          <input type="date" className="input h-9 w-40 text-sm" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="label">{t("common.to")}</label>
          <input type="date" className="input h-9 w-40 text-sm" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {([["month", "records.thisMonth"], ["prev", "records.lastMonth"], ["year", "records.thisYear"]] as const).map(([k, lbl]) => (
            <button
              key={k}
              className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
              onClick={() => preset(k)}
            >
              {t(lbl)}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q); }} className="flex items-end gap-2">
          <div>
            <label className="label">{t("common.search")}</label>
            <input
              className="input h-9 w-56 text-sm" placeholder="documento ou cliente"
              value={q} onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button className="btn-primary h-9 px-3 text-xs" type="submit">{t("common.search")}</button>
        </form>
        {filtersOn && (
          <button
            className="btn-ghost h-9 px-3 text-xs"
            onClick={() => { setStart(""); setEnd(""); setQ(""); setQuery(""); }}
          >
            {t("common.clear")}
          </button>
        )}
      </div>

      {/* Lista */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                <th className="w-8 px-2 py-3" />
                <th className="px-4 py-3 font-medium">{t("common.date")}</th>
                <th className="px-4 py-3 font-medium">Doc</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 text-right font-medium">Líquido €</th>
                <th className="px-4 py-3 text-right font-medium">Alíq. %</th>
                <th className="px-4 py-3 text-right font-medium">IVA €</th>
                <th className="px-4 py-3 text-right font-medium">Bruto €</th>
                <th className="px-4 py-3 font-medium">Origem</th>
                <th className="px-4 py-3 text-center font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const isOpen = expanded.has(s.id);
                const items = itemsCache[s.id];
                const b = isOpen && items ? rateBreakdown(s, items) : null;
                return (
                <Fragment key={s.id}>
                <tr className="border-b border-line/70">
                  <td className="px-2 py-2">
                    <button
                      className="text-muted transition-colors hover:text-ink"
                      onClick={() => toggleExpand(s.id)}
                      aria-expanded={isOpen}
                      title="Líquido por alíquota"
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                  </td>
                  <td className="px-4 py-2 tnum">{s.entry_date}</td>
                  <td className="px-4 py-2 font-mono text-xs">{s.doc_number || "—"}</td>
                  <td className="px-4 py-2">{s.customer || "—"}</td>
                  <td className="px-4 py-2 text-right tnum">{money(s.net_amount)}</td>
                  <td className="px-4 py-2 text-right tnum">{s.vat_rate ?? "—"}</td>
                  <td className="px-4 py-2 text-right tnum font-semibold">{money(s.vat_amount)}</td>
                  <td className="px-4 py-2 text-right tnum">{money((s.net_amount || 0) + (s.vat_amount || 0))}</td>
                  <td className="px-4 py-2 text-xs">
                    <span className="text-muted">{originLabel(s.source)}</span>
                    {s.document_path && (
                      <a
                        className="ml-2 text-brand hover:underline"
                        href={`/api/clients/${params.id}/sales/${s.id}/document`}
                        target="_blank" rel="noreferrer"
                      >
                        ver doc
                      </a>
                    )}
                    {s.reviewed_at
                      ? <span className="chip-ok ml-2" title={`por ${s.reviewed_by_email || "—"}`}>conferida</span>
                      : <span className={`ml-2 ${s.needs_review ? "chip-warn" : "chip bg-surface-2 text-muted"}`}>
                          {s.needs_review ? "revisar" : "a conferir"}
                        </span>}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-center gap-1">
                      <Link className="btn-ghost h-8 px-3 text-xs" href={`/clients/${params.id}/sales/${s.id}?ids=${ids}`}>
                        Conferir
                      </Link>
                      <button className="btn-ghost h-8 px-3 text-xs text-danger" onClick={() => remove(s.id)}>
                        {t("common.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-line/70 bg-surface-2/40">
                    <td />
                    <td colSpan={9} className="px-4 py-3">
                      {loadingItems.has(s.id) || !b ? (
                        <span className="text-xs text-muted">{t("common.loading")}</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                          <span><span className="text-muted">Bruto </span><strong className="tnum">€ {money(b.gross)}</strong></span>
                          <span><span className="text-muted">IVA </span><strong className="tnum">€ {money(s.vat_amount)}</strong></span>
                          {b.rates.map((r) => (
                            <span key={r.rate}>
                              <span className="text-muted">Líquido {r.rate}% </span>
                              <strong className="tnum">€ {money(r.net)}</strong>
                            </span>
                          ))}
                          <span className={b.reconciled ? "chip-ok" : "chip-warn"}>
                            {b.reconciled ? "Líquidos + IVA = Bruto" : "Líquidos + IVA ≠ Bruto — confira o documento"}
                          </span>
                          <button className="btn-ghost h-7 px-2 text-xs" onClick={() => copyBreakdown(s, b)}>
                            {copiedId === s.id ? "Copiado!" : "Copiar"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
              {!loading && !shown.length && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-muted">
                    {sales.length
                      ? "Nenhuma venda nestes filtros."
                      : "Nenhuma venda lançada ainda. Use “Lançar vendas” para digitar, importar planilha ou enviar foto."}
                  </td>
                </tr>
              )}
              {loading && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-muted">{t("common.loading")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {dialog && (
        <SalesEntryDialog
          clientId={params.id}
          onClose={() => setDialog(false)}
          onSaved={(n) => {
            setDialog(false);
            setMsg(`${n} venda(s) lançada(s). O IVA sobre vendas (T1) das obrigações foi atualizado.`);
            load();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold tnum ${
        warn ? "text-warning" : strong ? "text-brand-700" : ""
      }`}>
        {value}
      </div>
    </div>
  );
}
