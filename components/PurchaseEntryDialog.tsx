"use client";

/**
 * LANÇAR UMA COMPRA À MÃO — a rede de segurança que não existia.
 *
 * Até aqui a leitura por IA era o ÚNICO caminho para uma fatura de compra
 * entrar no sistema: o botão "Nova compra" levava ao ecrã de importação, e a
 * tela de Compras era só de leitura, sem botão de criar. Enquanto a leitura
 * funciona ninguém sente falta disto. No dia em que ela falha — e falhou, com
 * 504 em todas as tentativas — o módulo inteiro fica parado, e não há "faz-se
 * à mão entretanto", porque não havia "à mão".
 *
 * Isto não compete com a leitura automática nem a substitui: existe para os
 * casos em que ela não serve — o servidor que desistiu, o PDF que ninguém
 * percebe, a fatura que chegou em papel, e o dia em que a chave do Gemini
 * expirar. Um contabilista que consegue lançar à mão nunca fica bloqueado.
 *
 * Grava pelo MESMO caminho da leitura (`POST /api/invoices`), que já aceitava
 * um lançamento sem ficheiro anexo — por isso não há rota nova aqui, e por isso
 * a duplicata, o crédito por linha e o razão comportam-se exactamente como num
 * documento lido. Um lançamento manual não é um lançamento de segunda.
 */

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n";


/** Alíquotas oficiais irlandesas. Lista fechada em vez de campo livre. */
const VAT_RATES = [0, 4.8, 9, 13.5, 23];

const money = (n: number) => n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v.replace(",", ".")) || 0);

type Line = { description: string; net: string; rate: string; take_credit: boolean };
const blankLine = (): Line => ({ description: "", net: "", rate: "23", take_credit: true });

export default function PurchaseEntryDialog({
  clientId, activityCode, onClose, onSaved,
}: {
  clientId: string;
  activityCode: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useT();
  const today = new Date().toISOString().slice(0, 10);
  const [supplier, setSupplier] = useState("");
  const [supplierVat, setSupplierVat] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [postingDate, setPostingDate] = useState(today);
  const [lines, setLines] = useState<Line[]>(() => Array.from({ length: 3 }, blankLine));
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  /** Segunda passagem depois de o servidor acusar duplicata. */
  const [duplicateOf, setDuplicateOf] = useState<{ id: string; invoice_number: string | null; posting_date: string | null } | null>(null);

  const filled = lines.filter((l) => l.net.trim() !== "" || l.description.trim() !== "");

  const totals = useMemo(() => {
    let net = 0, vat = 0, credit = 0;
    for (const l of filled) {
      const n = numOrNull(l.net) ?? 0;
      const r = numOrNull(l.rate) ?? 0;
      const v = (n * r) / 100;
      net += n; vat += v;
      if (l.take_credit) credit += v;
    }
    return { net, vat, gross: net + vat, credit };
  }, [lines]);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  }

  /**
   * O que impede de gravar, dito por extenso.
   *
   * Devolve a lista inteira em vez de parar na primeira: quem preencheu mal
   * dois campos merece saber os dois de uma vez, não descobrir o segundo
   * depois de corrigir o primeiro.
   */
  function problems(): string[] {
    const out: string[] = [];
    if (!supplier.trim()) out.push(t("pe.needSupplier"));
    if (!invoiceDate) out.push(t("pe.needDate"));
    if (!filled.length) out.push(t("pe.needLine"));
    filled.forEach((l, i) => {
      const n = numOrNull(l.net);
      if (n === null) out.push(t("pe.lineNeedNet", { n: String(i + 1) }));
      // O negativo é recusado de propósito: numa COMPRA ele aumenta o crédito
      // de IVA a deduzir, que é o sentido que interessa a quem erra. Uma nota
      // de crédito de fornecedor é um documento próprio, não um sinal de menos
      // escondido no meio das linhas.
      else if (n < 0) out.push(t("pe.lineNegative", { n: String(i + 1) }));
      if (!VAT_RATES.includes(Number(l.rate))) out.push(t("pe.lineBadRate", { n: String(i + 1), r: l.rate }));
    });
    if (invoiceDate && invoiceDate > today) out.push(t("pe.futureDate"));
    return out;
  }

  async function save(force = false) {
    const errs = problems();
    if (errs.length) { setMsg({ text: errs.join(" "), error: true }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const items = filled.map((l) => {
        const net = numOrNull(l.net) ?? 0;
        const rate = numOrNull(l.rate) ?? 0;
        return {
          description: l.description.trim() || t("pe.defaultLineDesc"),
          quantity: null, unit_price: null,
          net_amount: net,
          vat_rate_on_invoice: rate,
          vat_amount_on_invoice: (net * rate) / 100,
          expected_vat_rate: rate,
          category_code: null, category_name: null,
          take_credit: l.take_credit,
          account_code: null, account_name: null,
        };
      });

      const meta = {
        client_id: clientId,
        branch_id: null,
        source: "manual",
        captured_at: null,
        doc_kind: "invoice",
        activity_code: activityCode || "GENERIC",
        // `engine: "manual"` é a marca de origem. O ecrã do documento mostra-a
        // ao lado de PDF/AI/OCR, para nunca haver dúvida sobre de onde veio o
        // número — foi lido, ou foi alguém que o escreveu.
        engine: "manual",
        original_filename: null,
        confidence: 1,
        // Um lançamento à mão NÃO nasce "a conferir": quem o escreveu está a
        // conferi-lo no acto. Marcar tudo para revisão faria a fila de revisão
        // encher de trabalho que já foi feito, e é assim que uma fila deixa de
        // ser lida.
        needs_review: false,
        issues: [],
        audit: [{ engine: "manual", confidence: 1 }],
        header: {
          supplier_name: supplier.trim(),
          store_name: null,
          supplier_vat: supplierVat.trim() || null,
          invoice_number: docNumber.trim() || null,
          barcode: null,
          invoice_date: invoiceDate,
          posting_date: postingDate || invoiceDate,
          invoice_time: null,
          doc_type: "invoice",
          total_net: totals.net,
          total_vat: totals.vat,
          total_gross: totals.gross,
        },
        items,
      };

      const fd = new FormData();
      fd.append("meta", JSON.stringify(meta));
      if (force) fd.append("force", "true");

      const res = await fetch("/api/invoices", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);

      if (res.status === 409 && data?.error === "duplicate") {
        setDuplicateOf(data.existing ?? null);
        setMsg({ text: t("pe.duplicate"), error: true });
        return;
      }
      if (!res.ok) {
        setMsg({ text: data?.error || t("pe.saveFailedCode", { code: String(res.status) }), error: true });
        return;
      }
      onSaved(data.invoice.id);
    } catch (e: any) {
      setMsg({ text: e?.message || t("common.saveFailed"), error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label={t("pe.title")}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <h2 className="font-display text-lg font-semibold">{t("pe.title")}</h2>
          <span className="text-xs text-muted">{t("pe.subtitle")}</span>
          <button className="btn-ghost ml-auto h-8 px-3 text-sm" onClick={onClose} aria-label={t("common.close")}>{t("common.close")}</button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <p className="mb-4 text-xs text-muted">
            {t("pe.help")}
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label" htmlFor="pe-supplier">{t("pe.supplier")} *</label>
              <input id="pe-supplier" className="input" value={supplier} maxLength={160}
                onChange={(e) => setSupplier(e.target.value)} placeholder={t("pe.supplierPlaceholder")} />
            </div>
            <div>
              <label className="label" htmlFor="pe-vat">{t("pe.supplierVat")}</label>
              <input id="pe-vat" className="input" value={supplierVat} maxLength={20}
                onChange={(e) => setSupplierVat(e.target.value.toUpperCase())} placeholder="IE1234567X" />
            </div>
            <div>
              <label className="label" htmlFor="pe-doc">{t("pe.docNumber")}</label>
              <input id="pe-doc" className="input" value={docNumber} maxLength={60}
                onChange={(e) => setDocNumber(e.target.value)} placeholder="FT 2026/1234" />
            </div>
            <div>
              <label className="label" htmlFor="pe-date">{t("pe.invoiceDate")} *</label>
              <input id="pe-date" type="date" className="input" value={invoiceDate} max={today}
                onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="pe-posting">{t("pe.postingDate")}</label>
              <input id="pe-posting" type="date" className="input" value={postingDate}
                onChange={(e) => setPostingDate(e.target.value)} />
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-medium">{t("pe.colDescription")}</th>
                  <th className="py-2 pr-3 font-medium text-right">{t("pe.colNet")}</th>
                  <th className="py-2 pr-3 font-medium">{t("pe.colRate")}</th>
                  <th className="py-2 pr-3 font-medium text-right">{t("pe.colVat")}</th>
                  <th className="py-2 pr-3 font-medium text-center">{t("pe.colCredit")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const net = numOrNull(l.net) ?? 0;
                  const vat = (net * (numOrNull(l.rate) ?? 0)) / 100;
                  return (
                    <tr key={i} className="border-b border-line/70">
                      <td className="py-2 pr-3">
                        <input className="input" value={l.description} maxLength={200}
                          onChange={(e) => setLine(i, { description: e.target.value })}
                          placeholder={t("pe.linePlaceholder")} aria-label={t("pe.colDescription")} />
                      </td>
                      <td className="py-2 pr-3">
                        {/*
                          `type="number"` com `min` e `step` — e não `text`.
                          O campo equivalente das vendas era texto puro, e a
                          consequência foi medida: `abc` virava € 0,00 em
                          silêncio e um valor negativo passava e mexia no IVA a
                          entregar. Aqui a categoria de erro inteira não existe.
                        */}
                        <input type="number" min="0" step="0.01" inputMode="decimal"
                          className="input text-right tnum" value={l.net}
                          onChange={(e) => setLine(i, { net: e.target.value })}
                          aria-label={t("pe.colNet")} />
                      </td>
                      <td className="py-2 pr-3">
                        <select className="input" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })}
                          aria-label={t("pe.colRate")}>
                          {VAT_RATES.map((r) => <option key={r} value={String(r)}>{r}%</option>)}
                        </select>
                      </td>
                      <td className="py-2 pr-3 text-right tnum text-muted">{money(vat)}</td>
                      <td className="py-2 pr-3 text-center">
                        <input type="checkbox" checked={l.take_credit}
                          onChange={(e) => setLine(i, { take_credit: e.target.checked })}
                          aria-label={t("pe.colCredit")} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button className="btn-ghost mt-3 h-8 px-3 text-sm" onClick={() => setLines((p) => [...p, blankLine()])}>
            {t("pe.addLine")}
          </button>

          <div className="mt-4 flex flex-wrap gap-4 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-sm">
            <span>{t("pe.totalNet")} <strong className="tnum">€ {money(totals.net)}</strong></span>
            <span>{t("pe.totalVat")} <strong className="tnum">€ {money(totals.vat)}</strong></span>
            <span>{t("pe.totalGross")} <strong className="tnum">€ {money(totals.gross)}</strong></span>
            <span className="text-brand-700">{t("pe.totalCredit")} <strong className="tnum">€ {money(totals.credit)}</strong></span>
          </div>

          {msg && (
            <p className={`mt-3 text-sm ${msg.error ? "text-danger" : "text-muted"}`}>{msg.text}</p>
          )}
          {duplicateOf && (
            <p className="mt-1 text-xs text-muted">
              {t("pe.duplicateOf", {
                doc: duplicateOf.invoice_number || t("pe.noDocNumber"),
                date: duplicateOf.posting_date || "—",
              })}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <button className="btn-primary h-9 px-4 text-sm" onClick={() => save(false)} disabled={saving}>
            {saving ? t("common.saving") : t("pe.save")}
          </button>
          {duplicateOf && (
            <button className="btn-ghost h-9 px-4 text-sm" onClick={() => save(true)} disabled={saving}>
              {t("pe.saveAnyway")}
            </button>
          )}
          <button className="btn-ghost h-9 px-4 text-sm" onClick={onClose} disabled={saving}>{t("common.cancel")}</button>
        </div>
      </div>
    </div>
  );
}
