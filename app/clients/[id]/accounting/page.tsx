"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import OpeningTab from "@/components/accounting/OpeningTab";
import DrillPanel from "@/components/accounting/DrillPanel";
import TaxPanel from "@/components/fiscal/TaxPanel";
import ClosingPanel from "@/components/accounting/ClosingPanel";

type Linha = { key: string; label: string; amount: number; computed?: boolean; level?: number; accounts?: any[] };
type Saldo = { account_code: string; account_name: string; type: string; report_group: string; balance: number; side: string };
type Dados = {
  from: string; to: string;
  trialBalance: Saldo[];
  profitAndLoss: Linha[]; profit: number;
  balanceSheet: Linha[]; netAssets: number; capitalAndReserves: number;
  balances: boolean; difference: number;
  equation: { assets: number; liabilities: number; equity: number; profit: number; difference: number; ok: boolean };
};

/*
 * A ORDEM DAS ABAS É A ORDEM DO TRABALHO.
 *
 * DRE, balanço e balancete são a leitura do razão; VAT e imposto são a
 * conferência contra o que vai na declaração; o FECHO vem depois deles porque
 * é o que se faz quando os três já batem; e a ABERTURA é a carga inicial, que
 * se faz uma vez na vida do cliente e depois nunca mais.
 *
 * Ela estava a meio e foi para o fim: uma aba que quase nunca se abre no meio
 * das que se abrem todos os dias é um passo a mais em cada travessia.
 */
const ABAS = ["pl", "bs", "trial", "vat", "tax", "closing", "opening"] as const;
type Aba = (typeof ABAS)[number];

type Visao = "enxuta" | "completa";

/**
 * Balancete, DRE e balanço — tudo lido do razão.
 *
 * Nenhum número desta tela é calculado aqui. Se o balanço não fechar, o
 * erro está num lançamento, e o caminho é o balancete → a conta → o
 * documento. Uma tela que "ajusta" para fechar esconde exatamente o que
 * precisa aparecer.
 *
 * O aviso de fechamento fica no topo e não no rodapé de propósito: é a
 * primeira coisa que se olha num relatório contábil, e um balanço que
 * não fecha não deve exigir rolagem para se descobrir.
 */
export default function AccountingPage({ params }: { params: { id: string } }) {
  const { t } = useT();
  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [aba, setAba] = useState<Aba>("pl");
  /*
   * A visão só vale para o FICHEIRO, e não para esta tela.
   *
   * A tela é sempre a cópia de trabalho: quem está aqui está a conferir
   * número, e cartões de KPI por cima do balancete só afastam a conta do
   * documento que a explica. O comparativo e os gráficos entram quando se
   * gera o que vai para fora.
   */
  const [visao, setVisao] = useState<Visao>("enxuta");
  const [d, setD] = useState<Dados | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<{ conta: string; from?: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/clients/${params.id}/accounting?year=${ano}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error || "Falhou.");
      setD(await r.json());
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, [params.id, ano]);

  useEffect(() => { load(); }, [load]);

  const eur = (v: number) =>
    (v < 0 ? "(" : "") + "€" +
    Math.abs(v).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
    (v < 0 ? ")" : "");

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{t("acc.title")}</h1>
          <p className="mt-1 text-muted">{t("acc.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col leading-tight">
            <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">{t("acc.year")}</span>
            <select className="input h-9 w-auto cursor-pointer py-0 text-[13px] font-semibold"
              value={ano} onChange={(e) => setAno(Number(e.target.value))}>
              {[ano + 1, ano, ano - 1, ano - 2].filter((v, i, a) => a.indexOf(v) === i)
                .sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          {/*
            Qual versão sai no ficheiro.
            Enxuta é a cópia de trabalho, para conferir número. Completa leva a
            coluna do ano anterior, os cartões de KPI e os gráficos, e é a que
            vai para a mão do cliente. Não é uma a substituir a outra: são
            usos diferentes, e por isso a escolha é aqui, na hora de gerar.
          */}
          <label className="flex flex-col leading-tight">
            <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">{t("acc.reportView")}</span>
            <select className="input h-9 w-auto cursor-pointer py-0 text-[13px] font-semibold"
              value={visao} onChange={(e) => setVisao(e.target.value as Visao)}>
              <option value="enxuta">{t("acc.viewLean")}</option>
              <option value="completa">{t("acc.viewFull")}</option>
            </select>
          </label>
          {/*
            * O botão de contabilizar MUDOU-SE para a Verificação.
            *
            * Pedido do Alfredo, e a lógica é dele: aqui é onde se LÊ o razão, e
            * ali é onde se pergunta se ele está em dia. Um botão que escreve no
            * meio dos botões que exportam relatórios convida ao clique
            * distraído — e quando falha, os erros apareciam nesta tela, longe
            * das outras verificações que explicam o mesmo problema.
            *
            * Fica o caminho, porque quem já sabia onde o botão estava tem de o
            * encontrar ao primeiro olhar.
            */}
          <Link className="btn-ghost" href={`/clients/${params.id}/checkup`}>
            {t("acc.postAllMoved")}
          </Link>
          {/* Os arquivos saem da MESMA função que monta a tela — o papel
              entregue ao cliente não pode discordar do que está aqui. */}
          <a className="btn-ghost" href={`/api/clients/${params.id}/accounting/export.pdf?year=${ano}&view=${visao}`}>PDF</a>
          <a className="btn-primary" href={`/api/clients/${params.id}/accounting/export.xlsx?year=${ano}&view=${visao}`}>Excel</a>
        </div>
      </div>

      {erro && <p className="text-sm text-danger">{erro}</p>}
      {msg && <p className="text-sm text-muted">{msg}</p>}

      {/*
        O veredito primeiro. Um balanço que não fecha não pode exigir
        rolagem para se descobrir — e a diferença é o número que diz
        onde procurar.
      */}
      {d && (
        <div className={`card flex flex-wrap items-center gap-3 border-l-4 p-4 ${
          d.balances ? "border-l-success" : "border-l-danger"
        }`}>
          <span className={`chip ${d.balances ? "chip-ok" : "chip-danger"}`}>
            {d.balances ? t("acc.balanced") : t("acc.notBalanced")}
          </span>
          <span className="text-sm text-muted">
            {t("acc.netAssets")} <b className="font-mono tabular-nums text-ink">{eur(d.netAssets)}</b>
            {"  ·  "}
            {t("acc.capitalReserves")} <b className="font-mono tabular-nums text-ink">{eur(d.capitalAndReserves)}</b>
          </span>
          {!d.balances && (
            <span className="text-sm font-semibold text-danger">
              {t("acc.difference")}: {eur(d.difference)}
            </span>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap gap-1 border-b border-line bg-surface-2/60 px-3 pt-2">
          {ABAS.map((a) => (
            <button key={a} onClick={() => setAba(a)}
              className={`subnav-item ${aba === a ? "subnav-item-active" : ""}`}>
              {t(("acc.tab_" + a) as any)}
            </button>
          ))}
        </div>

        {aba === "opening" && <OpeningTab clientId={params.id} />}
        {/*
          * A conciliação fiscal — o imposto dos documentos contra o do razão.
          * Ver components/fiscal/TaxPanel.tsx.
          */}
        {(aba === "vat" || aba === "tax") && (
          <TaxPanel clientId={params.id} tipo={aba === "vat" ? "vat" : "imposto"} />
        )}
        {/*
          * A rotina de fecho e o cadeado do período.
          * Ver components/accounting/ClosingPanel.tsx.
          */}
        {aba === "closing" && <ClosingPanel clientId={params.id} ano={ano} />}

        <div className="overflow-x-auto">
          {(aba === "pl" || aba === "bs") && (
            <table className="row-hover w-full text-sm">
              <tbody>
                {(aba === "pl" ? d?.profitAndLoss : d?.balanceSheet)?.map((l) => (
                  <tr key={l.key} className={`border-b border-line/70 ${l.computed ? "bg-surface-2/40 font-semibold" : ""}`}>
                    <td className="px-4 py-2" style={{ paddingLeft: 16 + (l.level ?? 0) * 20 }}>
                      {l.label}
                      {/* As contas que formam a rubrica: é o primeiro degrau
                          do caminho do relatório de volta ao documento. */}
                      {/* Cada conta da rubrica é um botão: é o primeiro
                          degrau do caminho de volta ao documento. */}
                      {!!l.accounts?.length && (
                        <span className="ml-2 inline-flex flex-wrap gap-1">
                          {l.accounts.map((a: any) => (
                            <button
                              key={a.account_code}
                              onClick={() => setDetalhe({
                                conta: a.account_code,
                                from: aba === "pl" ? d?.from : undefined,
                              })}
                              className="chip bg-surface-2 font-mono text-[10px] font-normal text-muted transition-colors hover:bg-brand-50 hover:text-brand-700"
                              title={t("drill.openAccount")}
                            >
                              {a.account_code}
                            </button>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{eur(l.amount)}</td>
                  </tr>
                ))}
                {!loading && !d?.profitAndLoss.length && aba === "pl" && (
                  <tr><td colSpan={2} className="px-4 py-10 text-center text-muted">{t("acc.empty")}</td></tr>
                )}
                {loading && (
                  <tr><td colSpan={2} className="px-4 py-10 text-center text-muted">{t("common.loading")}</td></tr>
                )}
              </tbody>
            </table>
          )}

          {aba === "trial" && (
            <div className="-mx-1 overflow-x-auto px-1">
            <table className="row-hover w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-medium">{t("acc.colCode")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("acc.colAccount")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("acc.colType")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("acc.colDebit")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("acc.colCredit")}</th>
                </tr>
              </thead>
              <tbody>
                {d?.trialBalance.map((s) => (
                  <tr key={s.account_code} className="cursor-pointer border-b border-line/70"
                      onClick={() => setDetalhe({ conta: s.account_code })}
                      title={t("drill.openAccount")}>
                    <td className="px-4 py-2 font-mono text-xs text-muted">{s.account_code}</td>
                    <td className="px-4 py-2 font-medium">{s.account_name}</td>
                    <td className="px-4 py-2 text-muted">{t(("acc.type_" + s.type) as any)}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {s.side === "debit" ? eur(s.balance) : ""}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {s.side === "credit" ? eur(s.balance) : ""}
                    </td>
                  </tr>
                ))}
                {d && (
                  <tr className="border-b border-line bg-surface-2/60 font-semibold">
                    <td className="px-4 py-2" colSpan={3}>{t("acc.total")}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {eur(d.trialBalance.filter((s) => s.side === "debit").reduce((a, s) => a + s.balance, 0))}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {eur(d.trialBalance.filter((s) => s.side === "credit").reduce((a, s) => a + s.balance, 0))}
                    </td>
                  </tr>
                )}
                {!loading && !d?.trialBalance.length && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">{t("acc.empty")}</td></tr>
                )}
              </tbody>
            </table>
            </div>
          )}
        </div>

        <div className="border-t border-line bg-surface-2/60 px-4 py-2.5 text-xs text-muted">
          {aba === "pl" && t("acc.noteP1")}
          {aba === "bs" && t("acc.noteBs")}
          {aba === "trial" && t("acc.noteTrial")}
          {aba === "opening" && t("acc.noteOpening")}
          {aba === "closing" && t("acc.noteClosing")}
        </div>
      </div>

      {detalhe && (
        <DrillPanel
          clientId={params.id}
          account={detalhe.conta}
          year={ano}
          from={detalhe.from}
          onClose={() => setDetalhe(null)}
        />
      )}
    </div>
  );
}
