"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

type Entrada = {
  id: string; date: string; entryDate: string; sourceModule: string;
  documentId: string | null; documentRef: string | null;
  counterparty: string | null; description: string | null;
  resolvedBy: string | null;
  debit: number; credit: number;
  vatAmount: number | null; netAmount: number | null;
};

type Dados = {
  account: { code: string; description?: string; type?: string };
  from: string | null; to: string;
  entries: Entrada[];
  debit: number; credit: number; balance: number;
  truncated: boolean;
};

/**
 * O detalhe de uma conta — o caminho de volta do número até a nota.
 *
 * Abre por cima da tela em vez de navegar: a pergunta "de onde vem este
 * número" é feita COM o relatório à frente, e sair dele para responder
 * obriga a pessoa a memorizar o valor que estava a investigar.
 *
 * Cada linha diz também POR QUE aquela conta foi escolhida — se veio da
 * classificação do item, da regra do fornecedor, ou do padrão. É a
 * segunda pergunta que o contador faz, logo depois de "de onde vem".
 */
export default function DrillPanel({
  clientId, account, year, from, onClose,
}: {
  clientId: string;
  account: string;
  year: number;
  /** Ausente = acumulado, que é o recorte do balanço. */
  from?: string | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ account, year: String(year) });
      if (from) qs.set("from", from);
      const r = await fetch(`/api/clients/${clientId}/accounting/drill?${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error || "Falhou.");
      setD(await r.json());
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    }
  }, [clientId, account, year, from]);

  useEffect(() => { load(); }, [load]);

  // Escape fecha: é o gesto que quem investiga faz sem pensar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const eur = (v: number) =>
    "€" + v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /** Para onde este lançamento leva. Sem documento, não há para onde ir. */
  const destino = (e: Entrada): string | null => {
    if (!e.documentId) return null;
    if (e.sourceModule === "purchase") return `/invoice/${e.documentId}?from=/clients/${clientId}/purchases`;
    if (e.sourceModule === "sale") return `/clients/${clientId}/sales`;
    if (e.sourceModule === "bank") return `/clients/${clientId}/bank`;
    return null;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-4xl overflow-hidden"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-2/60 px-4 py-3">
          <div>
            <h2 className="font-display text-base font-semibold">
              <span className="font-mono text-sm text-muted">{d?.account.code ?? account}</span>{" "}
              {d?.account.description ?? ""}
            </h2>
            <p className="text-xs text-muted">
              {from ? t("drill.period", { de: from, ate: d?.to ?? "" }) : t("drill.cumulative", { ate: d?.to ?? "" })}
            </p>
          </div>
          {d && (
            <span className="ml-auto text-sm text-muted">
              {t("acc.colDebit")} <b className="font-mono tabular-nums text-ink">{eur(d.debit)}</b>
              {" · "}
              {t("acc.colCredit")} <b className="font-mono tabular-nums text-ink">{eur(d.credit)}</b>
              {" · "}
              {t("drill.balance")} <b className="font-mono tabular-nums text-brand-700">{eur(d.balance)}</b>
            </span>
          )}
          <button className="btn-ghost h-8 px-3 text-xs" onClick={onClose}>{t("common.close")}</button>
        </div>

        {erro && <p className="px-4 py-3 text-sm text-danger">{erro}</p>}

        <div className="max-h-[60vh] overflow-auto">
          <table className="row-hover w-full text-sm">
            <thead className="sticky top-0">
              <tr className="border-b border-line bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">{t("drill.colDate")}</th>
                <th className="px-4 py-2 font-medium">{t("drill.colOrigin")}</th>
                <th className="px-4 py-2 font-medium">{t("drill.colParty")}</th>
                <th className="px-4 py-2 font-medium">{t("drill.colWhy")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("acc.colDebit")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("acc.colCredit")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {d?.entries.map((e) => {
                const url = destino(e);
                return (
                  <tr key={e.id} className="border-b border-line/70">
                    {/*
                      As DUAS datas quando diferem: a do documento e a
                      contábil. Quem investiga procura "aquela nota de
                      julho" — e o relatório usa a contábil, que pode ser
                      de agosto. Mostrar só uma faz a nota não ser
                      encontrada por quem sabe exatamente onde ela está.
                    */}
                    <td className="px-4 py-2 font-mono text-xs text-muted">
                      {e.entryDate && e.entryDate !== e.date ? (
                        <>
                          <span className="block text-ink">{e.entryDate}</span>
                          <span className="block text-[10px]" title={t("drill.postedOn")}>
                            → {e.date}
                          </span>
                        </>
                      ) : e.date}
                    </td>
                    <td className="px-4 py-2">
                      <span className="chip bg-surface-2 text-[10px] uppercase tracking-wide text-muted">
                        {t(("drill.src_" + e.sourceModule) as any)}
                      </span>
                      {e.documentRef && <span className="ml-2 font-mono text-xs">{e.documentRef}</span>}
                    </td>
                    <td className="px-4 py-2">{e.counterparty || "—"}</td>
                    <td className="px-4 py-2">
                      {e.resolvedBy
                        ? <span className="chip bg-brand-50 text-[10px] text-brand-700">
                            {t(("drill.why_" + e.resolvedBy) as any)}
                          </span>
                        : <span className="text-xs text-muted">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{e.debit ? eur(e.debit) : ""}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{e.credit ? eur(e.credit) : ""}</td>
                    <td className="px-4 py-2 text-right">
                      {url && (
                        <Link href={url} className="btn-ghost h-7 px-2 text-xs">{t("drill.open")}</Link>
                      )}
                    </td>
                  </tr>
                );
              })}
              {d && !d.entries.length && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">{t("drill.empty")}</td></tr>
              )}
              {!d && !erro && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">{t("common.loading")}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {d?.truncated && (
          <p className="border-t border-line bg-warning-50 px-4 py-2 text-xs text-warning">
            {t("drill.truncated")}
          </p>
        )}
      </div>
    </div>
  );
}
