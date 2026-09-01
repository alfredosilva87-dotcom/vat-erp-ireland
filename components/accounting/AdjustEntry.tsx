"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

/**
 * AJUSTAR a partida de um documento, a partir do próprio documento.
 *
 * ---------------------------------------------------------------------------
 * O PEDIDO, E O QUE ELE OBRIGA
 *
 * "Poderia ser possível alterar os lançamentos contábeis dos docs, para ajustes
 * e não perder o rastro, não só fazer via lançamento manual — seria no contas a
 * pagar/receber, notas, banco, todos os módulos que têm registro de docs."
 *
 * O resultado que ele quer é a partida certa. O que não se pode fazer para lá
 * chegar é reescrever as linhas: um lançamento alterado por cima não deixa
 * rasto nenhum, e o rasto era metade do pedido.
 *
 * Por isso o botão diz **Ajustar** e não "Editar", e o painel mostra em texto o
 * que vai acontecer: o original fica, nasce o espelho que o anula, e nasce a
 * correcção. Três partidas presas ao mesmo documento — que é o que faz o razão
 * recortado nele contar a história inteira.
 *
 * Vive num componente porque a mesma operação é pedida de quatro sítios (nota,
 * venda, banco, título) e a decisão de como se corrige contabilidade não pode
 * depender de qual das quatro telas alguém abriu.
 */

type Linha = { account_code: string; debit: number; credit: number; description?: string | null };
type Partida = {
  journalId: string; postingDate: string; sourceModule: string;
  documentId: string | null; documentRef: string | null; description: string | null;
  ehEstorno: boolean; jaEstornado: boolean; periodoFechado: boolean;
  linhas: (Linha & { line_no: number })[];
};
type Conta = { code: string; name: string; type: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
const eur = (n: number) => (n || 0).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AdjustEntry({
  clientId, journalId, aoAjustar,
}: {
  clientId: string;
  journalId: string;
  /** Para a tela de origem recarregar o rastro depois do ajuste. */
  aoAjustar?: () => void | Promise<void>;
}) {
  const { t } = useT();
  const [aberto, setAberto] = useState(false);
  const [p, setP] = useState<Partida | null>(null);
  const [contas, setContas] = useState<Conta[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    const r = await fetch(`/api/clients/${clientId}/accounting/entries/${journalId}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { setErro(j.error || "Falhou."); return; }
    setP(j.partida);
    setContas(j.contas);
    // Uma linha vazia no fim, para acrescentar sem ter de carregar em nada.
    setLinhas([...j.partida.linhas.map((l: Linha) => ({ ...l })), { account_code: "", debit: 0, credit: 0 }]);
  }, [clientId, journalId]);

  useEffect(() => { if (aberto && !p) carregar(); }, [aberto, p, carregar]);

  function mexer(i: number, campo: keyof Linha, v: string) {
    setLinhas((ls) => {
      const n = ls.map((l, k) => k !== i ? l : {
        ...l,
        [campo]: campo === "account_code" || campo === "description" ? v : r2(Number(v) || 0),
        // Débito e crédito na mesma linha é sempre engano: escrever num
        // zera o outro, em vez de deixar criar a linha que balanceia sozinha.
        ...(campo === "debit" ? { credit: 0 } : campo === "credit" ? { debit: 0 } : {}),
      });
      // Escreveu na última? Nasce outra vazia — a lista cresce sozinha.
      const ultima = n[n.length - 1];
      if (ultima.account_code || ultima.debit || ultima.credit) {
        n.push({ account_code: "", debit: 0, credit: 0 });
      }
      return n;
    });
  }

  const usadas = linhas.filter((l) => l.account_code && (l.debit || l.credit));
  const debito = r2(usadas.reduce((s, l) => s + (l.debit || 0), 0));
  const credito = r2(usadas.reduce((s, l) => s + (l.credit || 0), 0));
  const diferenca = r2(debito - credito);
  const fecha = diferenca === 0 && debito > 0;

  async function gravar() {
    setOcupado(true); setErro(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/accounting/entries/${journalId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: usadas, note: nota }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falhou."); return; }
      setFeito(j.novoId);
      setNota("");
      await aoAjustar?.();
    } finally { setOcupado(false); }
  }

  if (!aberto) {
    return (
      <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setAberto(true)}>
        {t("adjust.open")}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl2 border border-line bg-surface-2/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-display text-sm font-semibold">{t("adjust.title")}</h4>
        <button className="btn-ghost h-7 px-2 text-xs" onClick={() => { setAberto(false); setFeito(null); }}>
          {t("common.close")}
        </button>
      </div>

      {/*
        * O QUE VAI ACONTECER, em texto, antes de deixar mexer.
        *
        * Quem carrega em "Ajustar" espera editar. O que o sistema faz é
        * estornar e relançar — e descobrir isso só depois, ao ver três partidas
        * onde havia uma, lê-se como avaria.
        */}
      <p className="mt-1 max-w-3xl text-[12px] text-muted">{t("adjust.help")}</p>

      {!p && !erro && <p className="mt-3 text-sm text-muted">…</p>}

      {p?.ehEstorno && <p className="mt-3 text-sm text-danger">{t("adjust.isReversal")}</p>}
      {p?.jaEstornado && <p className="mt-3 text-sm text-danger">{t("adjust.alreadyReversed")}</p>}

      {p?.periodoFechado && !p.ehEstorno && !p.jaEstornado && (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px]">
          {t("adjust.closedPeriod", { data: p.postingDate })}
        </p>
      )}

      {feito && (
        <p className="mt-3 rounded-lg border border-ok/40 bg-success-50 px-3 py-2 text-sm">
          {t("adjust.done")}{" "}
          <Link className="underline" href={`/clients/${clientId}/ledger?doc=${p?.documentId ?? ""}`}>
            {t("adjust.seeInLedger")}
          </Link>
        </p>
      )}

      {p && !p.ehEstorno && !p.jaEstornado && !feito && (
        <>
          <div className="-mx-1 mt-3 overflow-x-auto px-1">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                  <th className="py-1.5 text-left">{t("adjust.colAccount")}</th>
                  <th className="py-1.5 text-left">{t("adjust.colHistory")}</th>
                  <th className="py-1.5 text-right">{t("ledger.colDebit")}</th>
                  <th className="py-1.5 text-right">{t("ledger.colCredit")}</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i} className="border-b border-line/50">
                    <td className="py-1.5 pr-2">
                      <select className="input h-8 w-full py-0 text-[12.5px]"
                        value={l.account_code} onChange={(e) => mexer(i, "account_code", e.target.value)}>
                        <option value="">—</option>
                        {contas.map((c) => (
                          <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <input className="input h-8 w-full py-0 text-[12.5px]"
                        value={l.description ?? ""} onChange={(e) => mexer(i, "description", e.target.value)} />
                    </td>
                    <td className="py-1.5 pl-2">
                      <input type="number" step="0.01" min="0" className="input h-8 w-28 py-0 text-right text-[12.5px] tabular-nums"
                        value={l.debit || ""} onChange={(e) => mexer(i, "debit", e.target.value)} />
                    </td>
                    <td className="py-1.5 pl-2">
                      <input type="number" step="0.01" min="0" className="input h-8 w-28 py-0 text-right text-[12.5px] tabular-nums"
                        value={l.credit || ""} onChange={(e) => mexer(i, "credit", e.target.value)} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {/*
                  * O TOTAL vive por baixo das linhas e diz a diferença enquanto
                  * se escreve. Descobrir que não fecha ao carregar em Gravar é
                  * descobrir tarde: a pessoa já mudou quatro campos e tem de
                  * refazer o raciocínio para saber qual deles está errado.
                  */}
                <tr className={`font-semibold ${fecha ? "" : "text-danger"}`}>
                  <td className="py-2" colSpan={2}>
                    {fecha ? t("adjust.balances") : t("adjust.outBy", { v: eur(Math.abs(diferenca)) })}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">{eur(debito)}</td>
                  <td className="py-2 text-right font-mono tabular-nums">{eur(credito)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <label className="mt-3 block">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("adjust.note")}</span>
            <input className="input mt-1 w-full text-sm" value={nota} onChange={(e) => setNota(e.target.value)}
              placeholder={t("adjust.notePlaceholder")} />
          </label>

          {erro && <p className="mt-2 text-sm text-danger">{erro}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-primary h-9 px-4 text-sm"
              disabled={ocupado || !fecha || nota.trim().length < 3} onClick={gravar}>
              {ocupado ? t("common.saving") : t("adjust.save")}
            </button>
            <span className="text-[11.5px] text-muted">{t("adjust.adminOnly")}</span>
          </div>
        </>
      )}

      {erro && !p && <p className="mt-3 text-sm text-danger">{erro}</p>}
    </div>
  );
}
