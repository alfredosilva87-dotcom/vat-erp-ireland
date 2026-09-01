"use client";

/**
 * As faturas que esta empresa emite.
 *
 * Separada de "Vendas" de propósito: Vendas é o que já aconteceu — notas lidas,
 * digitadas, importadas. Aqui é o que está a ser emitido AGORA. São o mesmo
 * módulo porque uma fatura emitida vira uma venda, mas são gestos diferentes e
 * misturá-los faria parecer dois registos da mesma coisa.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";

type Linha = {
  id: string; number: string; status: "draft" | "issued" | "sent" | "cancelled";
  customerName: string; issueDate: string; dueDate: string | null;
  net: number; vat: number; gross: number; saleId: string | null; sentAt: string | null;
};

const eur = (n: number) =>
  n.toLocaleString("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

const CHIP: Record<Linha["status"], string> = {
  draft: "chip", issued: "chip-ok", sent: "chip-ok", cancelled: "chip-danger",
};
/** A chave de traducao de cada estado — o rotulo sai do dicionario. */
const NOME: Record<Linha["status"], "inv.stDraft" | "inv.stIssued" | "inv.stSent" | "inv.stCancelled"> = {
  draft: "inv.stDraft", issued: "inv.stIssued", sent: "inv.stSent", cancelled: "inv.stCancelled",
};

export default function InvoicesPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { t } = useT();
  const [lista, setLista] = useState<Linha[] | null>(null);
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/clients/${params.id}/invoices`);
    const j = await r.json();
    setLista(j.invoices ?? []);
  }, [params.id]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function nova() {
    setCriando(true);
    try {
      const hoje = new Date().toISOString().slice(0, 10);
      const r = await fetch(`/api/clients/${params.id}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueDate: hoje, paymentTerms: "30 dias", items: [] }),
      });
      const j = await r.json();
      if (j.id) router.push(`/clients/${params.id}/invoices/${j.id}`);
    } finally { setCriando(false); }
  }

  const emitidas = (lista ?? []).filter((l) => l.status === "issued" || l.status === "sent");
  const porReceber = emitidas.reduce((s, l) => s + l.gross, 0);

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{t("inv.title")}</h1>
          <p className="mt-1 text-muted">
            {t("inv.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link className="btn-ghost inline-flex h-9 items-center px-4 text-sm" href={`/clients/${params.id}/customers`}>
            {t("cust.title")}
          </Link>
          <button className="btn-primary h-9 px-4 text-sm" disabled={criando} onClick={nova}>
            {criando ? t("inv.creating") : t("inv.new")}
          </button>
        </div>
      </div>

      {lista && lista.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Cartao rotulo={t("inv.cardIssued")} valor={String(emitidas.length)} />
          <Cartao rotulo={t("inv.cardTotal")} valor={eur(porReceber)} tom="accent" />
          <Cartao rotulo={t("inv.cardDrafts")} valor={String(lista.filter((l) => l.status === "draft").length)} />
        </div>
      )}

      <div className="card overflow-hidden">
        {lista === null ? (
          <p className="p-5 text-sm text-muted">{t("common.loading")}</p>
        ) : lista.length === 0 ? (
          <div className="p-6">
            <p className="text-sm text-muted">
              {t("inv.none")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 text-left font-medium">{t("inv.colNumber")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("inv.colCustomer")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("inv.colIssue")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("inv.colDue")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("common.total")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("inv.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((l) => (
                  <tr key={l.id} className={`border-b border-line/40 ${l.status === "cancelled" ? "opacity-55" : ""}`}>
                    <td className="px-3 py-2">
                      <Link className="font-mono text-[12px] underline" href={`/clients/${params.id}/invoices/${l.id}`}>
                        {l.status === "draft" ? t("inv.draftMarker") : l.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{l.customerName}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-muted">{l.issueDate}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-muted">{l.dueDate || "—"}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.gross)}</td>
                    <td className="px-3 py-2">
                      <span className={`${CHIP[l.status]} text-[11px]`}>{t(NOME[l.status])}</span>
                      {l.sentAt && <span className="ml-2 text-[11px] text-muted">{t("inv.stSent")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Cartao({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: "accent" }) {
  return (
    <div className="card p-4">
      <div className="text-[10.5px] uppercase tracking-wide text-muted">{rotulo}</div>
      <div className={`mt-1 font-display text-2xl font-semibold ${tom === "accent" ? "text-brand" : ""}`}>{valor}</div>
    </div>
  );
}
