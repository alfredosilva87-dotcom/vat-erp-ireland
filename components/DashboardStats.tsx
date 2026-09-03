"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { EXERCISE_EVENT, getExercise, defaultExercise } from "@/lib/exercise";

type Stats = {
  invoices: number; items: number; unique_items: number; clients: number;
  needs_review: number; total_credit: number; total_gross: number;
  sales_gross: number; sales_vat: number; vat_payable: number;
};
const money = (n: number) => n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DashboardStats() {
  const { t } = useT();
  const [s, setS] = useState<Stats | null>(null);
  /*
   * O painel primário passa a obedecer ao exercício fiscal da barra do topo.
   *
   * Até aqui somava o histórico inteiro e ignorava o seletor — que era metade
   * do motivo de o controlo parecer quebrado: mudava-se o ano e nenhum número
   * na tela se mexia. Agora os totais de VAT, vendas e compras são do ano
   * escolhido; a contagem de clientes e do catálogo continua sem data, porque
   * não faria sentido encolher com o ano.
   */
  const [year, setYear] = useState<number>(defaultExercise);

  useEffect(() => {
    const ler = () => setYear(getExercise());
    ler();
    window.addEventListener(EXERCISE_EVENT, ler);
    return () => window.removeEventListener(EXERCISE_EVENT, ler);
  }, []);

  useEffect(() => {
    fetch(`/api/invoices?year=${year}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => setS(d.stats)).catch(() => {});
  }, [year]);

  /*
   * OS CARTOES DIZEM DE QUE PERIODO SAO.
   *
   * Eles leem `/api/invoices?year=…` — o exercicio da barra do topo — e a
   * tabela de clientes logo por baixo e o historico INTEIRO. Sem rotulo, o
   * ecra mostrava "PURCHASES 25 invoices" com uma tabela por baixo a somar 27,
   * e "INPUT CREDIT EUR 644,60" contra um "Total credit EUR 694,78" na mesma
   * pagina. Nao ha erro de calculo nenhum: sao recortes diferentes. Mas dois
   * numeros diferentes para a mesma coisa no mesmo ecra destroem a confianca
   * no relatorio, e quem le nao tem como adivinhar qual e qual.
   */
  const tiles = [
    {
      label: t("dash.revenueT1"), value: s ? `€ ${money(s.sales_gross)}` : "—",
      sub: s ? `VAT € ${money(s.sales_vat)}` : "", tone: "brand" as const, icon: IconTrend,
    },
    {
      label: t("dash.purchasesT2"), value: s ? `€ ${money(s.total_gross)}` : "—",
      sub: s ? `${s.invoices} ${t("dash.invoices").toLowerCase()}` : "", tone: "violet" as const, icon: IconDoc,
    },
    {
      label: t("dash.vatPayableT3"), value: s ? `€ ${money(s.vat_payable)}` : "—",
      sub: s ? (s.vat_payable >= 0 ? t("dash.toPay") : t("dash.toReclaim")) : "",
      tone: (s && s.vat_payable < 0 ? "success" : "danger") as "success" | "danger", icon: IconReceipt,
    },
    {
      label: t("dash.inputCredit"), value: s ? `€ ${money(s.total_credit)}` : "—",
      sub: s ? t("dash.creditSub", { c: String(s.clients), i: String(s.unique_items) }) : "", tone: "success" as const, icon: IconEuro,
    },
  ];
  const toneCls = {
    brand: "bg-brand-50 text-brand-700",
    violet: "bg-violet-50 text-violet",
    success: "bg-success-50 text-success",
    danger: "bg-danger-50 text-danger",
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{t("dash.periodNote", { year: String(year) })}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t, i) => {
          const Icon = t.icon;
          return (
            <div key={t.label} className="card rise p-5" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted">{t.label}</div>
                  <div className="mt-1.5 font-display text-2xl font-semibold tnum">{t.value}</div>
                </div>
                <span className={`badge-soft shrink-0 ${toneCls[t.tone]}`}><Icon /></span>
              </div>
              <div className="mt-2 text-xs text-muted">{t.sub || " "}</div>
            </div>
          );
        })}
      </div>

      {!!s?.needs_review && (
        <Link
          href="/records"
          className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning-50 px-4 py-2.5 text-sm text-warning transition-colors hover:border-warning"
        >
          <strong>{s.needs_review}</strong> {t("dash.needsReviewAlert")}
        </Link>
      )}
    </div>
  );
}

function b(c: React.ReactNode) { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">{c}</svg>; }
const S = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function IconEuro() { return b(<><path d="M18 7.5A6 6 0 1 0 18 16.5" {...S} /><path d="M4 10.5h9M4 13.5h9" {...S} /></>); }
function IconDoc() { return b(<><path d="M7 3h7l4 4v14H7z" {...S} /><path d="M14 3v4h4M10 12h6M10 16h6" {...S} /></>); }
function IconTrend() { return b(<><path d="M3 17l6-6 4 4 7-7" {...S} /><path d="M20 8v5h-5" {...S} /></>); }
function IconReceipt() { return b(<><path d="M5 3v18l2.5-1.5L10 21l2-1.5L14 21l2.5-1.5L19 21V3z" {...S} /><path d="M9 8h6M9 12h6" {...S} /></>); }
