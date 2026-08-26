"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { eur } from "@/components/financial/tipos";

/**
 * Dinheiro a entrar e a sair, no painel do cliente.
 *
 * O painel mostrava imposto e faturação — o que a Revenue pergunta — e não
 * mostrava dinheiro. "Quanto tenho a receber" só existia dentro da tela de
 * contas a receber, atrás de um filtro, e por isso ninguém a via ao abrir o
 * cliente.
 *
 * Os PARCIAIS vêm em lista própria e não diluídos no total, porque são o caso
 * que exige decisão: alguém pagou parte e parou. Somados ao resto, desaparecem.
 * Ver `lib/financial/aging.ts`.
 */

type Lado = {
  titulos: number; aberto: number; vencido: number;
  aVencer30: number; parciais: number; abertoEmParciais: number;
};
type Parcial = {
  id: string; kind: "payable" | "receivable";
  documentRef: string | null; contraparte: string | null; dueDate: string | null;
  original: number; encargos: number; pago: number; aberto: number;
  pagoPct: number; vencido: boolean;
};
type Aging = { payable: Lado; receivable: Lado; parciais: Parcial[] };

export default function AgingPanel({ clientId }: { clientId: string }) {
  const { t } = useT();
  const [d, setD] = useState<Aging | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/clients/${clientId}/aging`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setD(j); })
      .catch(() => { /* o painel sobrevive sem este bloco */ });
    return () => { vivo = false; };
  }, [clientId]);

  if (!d) return null;
  const nada = d.payable.titulos === 0 && d.receivable.titulos === 0;
  if (nada) return null;

  return (
    <section className="space-y-4">
      <h2 className="font-display text-xl font-semibold tracking-tight">{t("aging.title")}</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Lado
          titulo={t("aging.receivable")} lado={d.receivable} tom="success"
          href={`/clients/${clientId}/receivable`} t={t}
        />
        <Lado
          titulo={t("aging.payable")} lado={d.payable} tom="danger"
          href={`/clients/${clientId}/payable`} t={t}
        />
      </div>

      {d.parciais.length > 0 && (
        <section className="card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-lg font-semibold">{t("aging.partialsTitle")}</h3>
            <p className="text-xs text-muted">{t("aging.partialsHelp")}</p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                  <th className="py-1 text-left font-medium">{t("aging.colDoc")}</th>
                  <th className="py-1 text-left font-medium">{t("aging.colDue")}</th>
                  <th className="py-1 text-right font-medium">{t("aging.colDue2")}</th>
                  <th className="py-1 text-right font-medium">{t("aging.colPaid")}</th>
                  <th className="py-1 text-right font-medium">{t("aging.colOpen")}</th>
                  <th className="py-1 text-left font-medium">{t("aging.colProgress")}</th>
                </tr>
              </thead>
              <tbody>
                {d.parciais.map((p) => (
                  <tr key={p.id} className="border-b border-line/40">
                    <td className="py-1.5">
                      <Link
                        className="font-mono text-[12px] underline"
                        href={`/clients/${clientId}/${p.kind === "payable" ? "payable" : "receivable"}?status=todos&q=${encodeURIComponent(p.documentRef ?? "")}`}
                      >
                        {p.documentRef || "—"}
                      </Link>
                      {p.contraparte && <span className="ml-2 text-muted">{p.contraparte}</span>}
                    </td>
                    <td className={`py-1.5 font-mono text-[12px] ${p.vencido ? "text-danger" : "text-muted"}`}>
                      {p.dueDate || "—"}
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {eur(p.original + p.encargos)}
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{eur(p.pago)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums font-semibold">{eur(p.aberto)}</td>
                    <td className="py-1.5">
                      {/* A barra diz de relance o quanto falta — um número
                          sozinho obriga a fazer a divisão de cabeça. */}
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
                          <span
                            className="block h-full rounded-full bg-brand"
                            style={{ width: `${Math.min(100, Math.max(2, p.pagoPct))}%` }}
                          />
                        </span>
                        <span className="tabular-nums text-[11px] text-muted">{p.pagoPct}%</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}

function Lado({
  titulo, lado, tom, href, t,
}: {
  titulo: string; lado: Lado; tom: "success" | "danger"; href: string;
  t: (k: any, v?: any) => string;
}) {
  return (
    <Link href={href} className="card block p-5 transition hover:shadow-brand">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">{titulo}</div>
          <div className="mt-1.5 font-display text-2xl font-semibold tnum">€ {eur(lado.aberto)}</div>
          <div className="mt-1 text-xs text-muted">
            {lado.titulos} {t("aging.openItems")}
          </div>
        </div>
        <span className={`badge-soft shrink-0 ${tom === "success" ? "bg-success-50 text-success" : "bg-danger-50 text-danger"}`}>
          {tom === "success" ? "↓" : "↑"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        {lado.vencido > 0 && (
          <span className="chip-danger">{t("aging.overdue")} € {eur(lado.vencido)}</span>
        )}
        {lado.aVencer30 > 0 && (
          <span className="chip-warn">{t("aging.next30")} € {eur(lado.aVencer30)}</span>
        )}
        {lado.parciais > 0 && (
          <span className="chip">{lado.parciais} {t("aging.partialChip")}</span>
        )}
      </div>
    </Link>
  );
}
