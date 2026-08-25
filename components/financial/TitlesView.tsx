"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PainelDoTitulo from "@/components/financial/TitlePanel";
import type { Titulo } from "@/components/financial/tipos";
import { eur } from "@/components/financial/tipos";

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



const ESTADOS = [
  { v: "pendentes", r: "Pendentes" },
  { v: "overdue", r: "Vencidos" },
  { v: "partial", r: "Parciais" },
  { v: "settled", r: "Quitados" },
  { v: "todos", r: "Todos" },
];



const CHIP: Record<string, string> = {
  open: "chip bg-surface-2 text-muted", partial: "chip-warn",
  overdue: "chip-danger", settled: "chip-ok",
};
const NOME: Record<string, string> = {
  open: "Em aberto", partial: "Parcial", overdue: "Vencido", settled: "Quitado",
};

export default function TitlesView({ clientId, kind }: { clientId: string; kind: "payable" | "receivable" }) {
  const [status, setStatus] = useState("pendentes");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [d, setD] = useState<{ items: Titulo[]; total: number; totals: any; size: number } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);

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
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">Situação</span>
          <select className="input h-9 w-auto cursor-pointer py-0 text-[13px] font-semibold"
            value={status} onChange={(e) => setStatus(e.target.value)}>
            {ESTADOS.map((s) => <option key={s.v} value={s.v}>{s.r}</option>)}
          </select>
        </label>
        <label className="flex flex-col leading-tight">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">Vence de</span>
          <input type="date" className="input h-9 w-auto py-0 text-[13px]" value={de} onChange={(e) => setDe(e.target.value)} />
        </label>
        <label className="flex flex-col leading-tight">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">até</span>
          <input type="date" className="input h-9 w-auto py-0 text-[13px]" value={ate} onChange={(e) => setAte(e.target.value)} />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col leading-tight">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">{contraparte} ou documento</span>
          <input className="input h-9 w-full py-0 text-[13px]" value={busca}
            onChange={(e) => setBusca(e.target.value)} placeholder="procurar…" />
        </label>
      </div>

      {d && (
        <div className="card flex flex-wrap items-center justify-between gap-4 border-l-4 border-l-brand p-4">
          <span className="text-sm">
            <b className="tabular-nums">{d.total}</b> título(s) no filtro
          </span>
          <span className="flex flex-wrap gap-5 font-mono text-sm tabular-nums">
            <span className="text-muted">Original <b className="text-ink">{eur(d.totals.original)}</b></span>
            {d.totals.charges !== 0 && (
              <span className="text-muted">Encargos <b className="text-ink">{eur(d.totals.charges)}</b></span>
            )}
            <span className="text-muted">Pago <b className="text-ink">{eur(d.totals.settled)}</b></span>
            <span className="text-muted">Em aberto <b className="text-ink">{eur(d.totals.outstanding)}</b></span>
            {d.totals.overdue > 0 && (
              <span className="text-danger">Vencido <b>{eur(d.totals.overdue)}</b></span>
            )}
          </span>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 text-left font-medium">Vencimento</th>
                <th className="px-3 py-2 text-left font-medium">Documento</th>
                <th className="px-3 py-2 text-left font-medium">{contraparte}</th>
                <th className="px-3 py-2 text-right font-medium">Original</th>
                <th className="px-3 py-2 text-right font-medium">Encargos</th>
                <th className="px-3 py-2 text-right font-medium">Pago</th>
                <th className="px-3 py-2 text-right font-medium">Em aberto</th>
                <th className="px-3 py-2 text-left font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {(d?.items ?? []).map((t) => (
                <tr key={t.id} onClick={() => setAberto(t.id)}
                  className="cursor-pointer border-b border-line/50 hover:bg-surface-2/60">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px]">{t.due_date || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px]">
                    {t.document_ref || <span className="text-muted">{t.source_module}</span>}
                  </td>
                  <td className="px-3 py-2">{t.counterparty || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(t.original_amount)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {Number(t.charges_amount) ? eur(t.charges_amount) : ""}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                    {Number(t.settled_amount) ? eur(t.settled_amount) : ""}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{eur(t.outstanding_amount)}</td>
                  <td className="px-3 py-2">
                    <span className={`${CHIP[t.status] ?? "chip"} text-[11px]`}>{NOME[t.status] ?? t.status}</span>
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
          <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
            <span>Página {pagina + 1} de {paginas}</span>
            <span className="flex gap-2">
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

