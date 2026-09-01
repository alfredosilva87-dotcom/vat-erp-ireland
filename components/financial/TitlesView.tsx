"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import PainelDoTitulo from "@/components/financial/TitlePanel";
import NovoTituloManual from "@/components/financial/NovoTituloManual";
import type { Titulo } from "@/components/financial/tipos";
import { eur } from "@/components/financial/tipos";
import { useT } from "@/lib/i18n";

/**
 * Contas a pagar e a receber. O mesmo ecrã, dos dois lados.
 *
 * A diferença entre pagar e receber é a natureza do título e as palavras
 * ("fornecedor" / "cliente"). Tudo o resto — o filtro, a lista, os totais, os
 * encargos — é idêntico, e duplicar o ficheiro faria as duas telas divergirem
 * na primeira correção que alguém esquecesse de copiar.
 *
 * ---------------------------------------------------------------------------
 * A LISTA ABRE FILTRADA, E ISSO É O DESENHO
 *
 * O padrão é "pendentes". Um cliente com três anos de movimento tem milhares
 * de títulos e quase todos já foram pagos: mostrar tudo é lento e esconde os
 * sessenta que interessam no meio dos três mil que não. O histórico está a um
 * clique, por data.
 *
 * Os totais somam o FILTRO INTEIRO e não a página visível — "quanto devo?" é a
 * pergunta que se faz olhando para este rodapé.
 * ---------------------------------------------------------------------------
 */



/*
 * Só as CHAVES; o texto sai do dicionário dentro do componente.
 *
 * Estava tudo escrito em português aqui, e esta é a tela que o escritório abre
 * todos os dias — num ERP irlandês era a que mais mal ficava em inglês. O
 * mesmo vale para os nomes das situações.
 */
const ESTADOS = ["pendentes", "overdue", "partial", "settled", "todos"] as const;



const CHIP: Record<string, string> = {
  open: "chip bg-surface-2 text-muted", partial: "chip-warn",
  overdue: "chip-danger", settled: "chip-ok",
};


export default function TitlesView({ clientId, kind }: { clientId: string; kind: "payable" | "receivable" }) {
  const { t } = useT();
  /*
   * O filtro pode vir na URL, e é isso que faz o RASTRO funcionar.
   *
   * O bloco "Integração" da nota liga para cá com `?q=<numero>&status=todos`.
   * Sem ler estes dois parâmetros, o link caía na lista filtrada por
   * "pendentes" e um título já quitado simplesmente não aparecia — o rastro
   * apontaria para um ecrã vazio, que é pior do que não ter rastro: diz que
   * não existe uma coisa que existe.
   *
   * Só no arranque (`useState` com inicial), e não num efeito que sincroniza:
   * depois de a pessoa mexer no filtro, quem manda é o filtro e não a URL.
   */
  const sp = useSearchParams();
  const [status, setStatus] = useState(() => sp?.get("status") || "pendentes");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [busca, setBusca] = useState(() => sp?.get("q") || "");
  const [pagina, setPagina] = useState(0);
  const [d, setD] = useState<{
    items: Titulo[]; total: number; totals: any; size: number;
    control?: { accounts: string[]; ledgerBalance: number; agingOutstanding: number; difference: number };
  } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);
  const [lancando, setLancando] = useState(false);

  const contraparte = kind === "payable" ? "Fornecedor" : "Cliente";

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const q = new URLSearchParams({ kind, status, page: String(pagina) });
      if (de) q.set("from", de);
      if (ate) q.set("to", ate);
      if (busca.trim()) q.set("q", busca.trim());
      const r = await fetch(`/api/clients/${clientId}/titles?${q}`, { cache: "no-store" });
      if (r.ok) setD(await r.json());
    } finally {
      setCarregando(false);
    }
  }, [clientId, kind, status, de, ate, busca, pagina]);

  useEffect(() => { carregar(); }, [carregar]);
  // Trocar de filtro volta à primeira página: ficar na página 4 de um filtro
  // que agora tem 2 páginas mostra uma lista vazia que parece "não há nada".
  useEffect(() => { setPagina(0); }, [status, de, ate, busca]);

  const paginas = useMemo(
    () => (d ? Math.max(1, Math.ceil(d.total / (d.size || 50))) : 1), [d]);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col leading-tight">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">{t("titles.status")}</span>
          <select className="input h-9 w-auto cursor-pointer py-0 text-[13px] font-semibold"
            value={status} onChange={(e) => setStatus(e.target.value)}>
            {ESTADOS.map((e) => <option key={e} value={e}>{t(("titles.st_" + e) as any)}</option>)}
          </select>
        </label>
        <label className="flex flex-col leading-tight">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">{t("titles.dueFrom")}</span>
          <input type="date" className="input h-9 w-auto py-0 text-[13px]" value={de} onChange={(e) => setDe(e.target.value)} />
        </label>
        <label className="flex flex-col leading-tight">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">{t("titles.dueTo")}</span>
          <input type="date" className="input h-9 w-auto py-0 text-[13px]" value={ate} onChange={(e) => setAte(e.target.value)} />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col leading-tight">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">{t("titles.searchBy", { n: contraparte })}</span>
          <input className="input h-9 w-full py-0 text-[13px]" value={busca}
            onChange={(e) => setBusca(e.target.value)} placeholder={t("titles.search")} />
        </label>
        {/*
          * Lançar à mão: taxa, imposto, seguro — dívida que não vem de nota.
          * Sem isto, ou ficava fora da lista (e "quanto devo" mente por
          * omissão) ou alguém inventava uma nota de compra falsa para a
          * acomodar, que entra na apuração de VAT como se fosse compra.
          */}
        <button className="btn-primary h-9 shrink-0 px-4 text-sm" onClick={() => setLancando(true)}>
          {t("titles.addManual")}
        </button>
      </div>

      {lancando && (
        <NovoTituloManual
          clientId={clientId} kind={kind}
          aoFechar={() => setLancando(false)}
          aoCriar={async () => { setLancando(false); await carregar(); }}
        />
      )}

      {d && (
        <div className="card flex flex-wrap items-center justify-between gap-4 border-l-4 border-l-brand p-4">
          <span className="text-sm">
            <b className="tabular-nums">{d.total}</b> título(s) no filtro
          </span>
          <span className="flex flex-wrap gap-5 font-mono text-sm tabular-nums">
            <span className="text-muted">{t("titles.original")} <b className="text-ink">{eur(d.totals.original)}</b></span>
            {d.totals.charges !== 0 && (
              <span className="text-muted">{t("titles.charges")} <b className="text-ink">{eur(d.totals.charges)}</b></span>
            )}
            <span className="text-muted">{t("titles.settled")} <b className="text-ink">{eur(d.totals.settled)}</b></span>
            <span className="text-muted">{t("titles.outstanding")} <b className="text-ink">{eur(d.totals.outstanding)}</b></span>
            {d.totals.overdue > 0 && (
              <span className="text-danger">{t("titles.overdue")} <b>{eur(d.totals.overdue)}</b></span>
            )}
          </span>
        </div>
      )}

      {/*
        * A CONCILIAÇÃO da conta de controlo.
        *
        * 2100 e 1200 não são transitórias — são de controlo, e a única coisa
        * que se lhes exige é que o saldo seja exactamente o que está em aberto
        * aqui. Quando não é, uma das duas telas está errada e não há como
        * saber qual olhando só para uma.
        *
        * Aconteceu a sério: a carga de abertura lançava 1200 em bloco, sem
        * título por trás. O razão dizia 11.028,37, esta lista dizia 4.728,37,
        * e as duas estavam certas à sua maneira. O balanço continuava a fechar
        * — o lançamento de abertura está balanceado —, então nada avisava.
        *
        * Diferença NÃO é acusação: pode ser abertura por detalhar ou um
        * lançamento manual legítimo. Por isso mostra-se o número, e a decisão
        * é de quem concilia.
        */}
      {d?.control && (
        <div className={`card flex flex-wrap items-center justify-between gap-4 border-l-4 p-4 ${
          d.control.difference === 0 ? "border-l-ok" : "border-l-warning"
        }`}>
          <span className="text-sm">
            {d.control.difference === 0 ? (
              <><span className="chip-ok mr-2">concilia</span>
              O razão explica todos os títulos em aberto</>
            ) : (
              <><span className="chip-warn mr-2">a conciliar</span>
              O razão e os títulos não dizem o mesmo</>
            )}
            <span className="ml-2 text-muted">
              conta{d.control.accounts.length > 1 ? "s" : ""} {d.control.accounts.join(", ")}
            </span>
          </span>
          <span className="flex flex-wrap gap-5 font-mono text-sm tabular-nums">
            <span className="text-muted">{t("titles.ledger")} <b className="text-ink">{eur(d.control.ledgerBalance)}</b></span>
            <span className="text-muted">{t("titles.titles")} <b className="text-ink">{eur(d.control.agingOutstanding)}</b></span>
            <span className={d.control.difference === 0 ? "text-muted" : "text-warning"}>
              Diferença <b>{eur(d.control.difference)}</b>
            </span>
          </span>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 text-left font-medium">{t("titles.dueDate")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("titles.document")}</th>
                <th className="px-3 py-2 text-left font-medium">{contraparte}</th>
                <th className="px-3 py-2 text-right font-medium">{t("titles.original")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("titles.charges")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("titles.settled")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("titles.outstanding")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("titles.status")}</th>
              </tr>
            </thead>
            <tbody>
              {(d?.items ?? []).map((ti) => (
                <tr key={ti.id} onClick={() => setAberto(ti.id)}
                  className="cursor-pointer border-b border-line/50 hover:bg-surface-2/60">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px]">{ti.due_date || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px]">
                    {ti.document_ref || <span className="text-muted">{ti.source_module}</span>}
                  </td>
                  <td className="px-3 py-2">{ti.counterparty || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(ti.original_amount)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {Number(ti.charges_amount) ? eur(ti.charges_amount) : ""}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                    {Number(ti.settled_amount) ? eur(ti.settled_amount) : ""}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{eur(ti.outstanding_amount)}</td>
                  <td className="px-3 py-2">
                    <span className={`${CHIP[ti.status] ?? "chip"} text-[11px]`}>{t(("titles.s_" + ti.status) as any)}</span>
                  </td>
                </tr>
              ))}
              {!carregando && (d?.items?.length ?? 0) === 0 && (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-muted">
                  Nada neste filtro.
                </td></tr>
              )}
              {carregando && (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-muted">…</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {paginas > 1 && (
          <div className="flex flex-wrap items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
            <span>Página {pagina + 1} de {paginas}</span>
            <span className="flex flex-wrap gap-2">
              <button className="btn-ghost h-7 px-3" disabled={pagina === 0}
                onClick={() => setPagina((p) => p - 1)}>Anterior</button>
              <button className="btn-ghost h-7 px-3" disabled={pagina + 1 >= paginas}
                onClick={() => setPagina((p) => p + 1)}>Próxima</button>
            </span>
          </div>
        )}
      </div>

      {aberto && (
        <PainelDoTitulo clientId={clientId} titleId={aberto} contraparte={contraparte}
          aoFechar={() => setAberto(null)} aoMudar={carregar} />
      )}
    </div>
  );
}

