"use client";

import { useState } from "react";
import { useT, type TKey } from "@/lib/i18n";

/**
 * Carregar funcionários e acumulados de outro sistema.
 *
 * ---------------------------------------------------------------------------
 * A PRÉ-VISUALIZAÇÃO NÃO É CORTESIA — É O PRODUTO
 *
 * Importar acumulados errados não dá erro nenhum: a primeira folha sai
 * plausível e a diferença aparece meses depois, na conta da Revenue. Por isso a
 * tela mostra, ANTES de gravar, o que vai acontecer a cada pessoa — e, para
 * quem trouxe acumulado, se o imposto que o ficheiro afirma **bate com o que o
 * nosso motor calcula**.
 *
 * Se bater, a migração está certa. Se não bater, alguma coluna está trocada, e
 * isso vê-se aqui em vez de se descobrir em Novembro.
 */

type Conferencia = {
  payeFicheiro: number; payeMotor: number; difPaye: number;
  uscFicheiro: number; uscMotor: number; difUsc: number; bate: boolean;
};
type Linha = {
  linha: number; nome: string; dados: any; erro: string | null; avisos: string[];
  acao: "criar" | "actualizar" | "ignorar"; existenteId: string | null;
  conferencia: Conferencia | null;
};
type Previa = { ignoradas: string[]; reconhecidas: string[]; linhas: Linha[] };

const eur = (c: number | null | undefined) =>
  c === null || c === undefined ? "—" : (Number(c) / 100).toFixed(2);

export default function ImportEmployees({ clientId, year }: { clientId: string; year: number }) {
  const { t } = useT();
  const [csv, setCsv] = useState("");
  const [p, setP] = useState<Previa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function correr(commit: boolean) {
    setOcupado(true); setErro(null); setFeito(null);
    try {
      const r = await fetch(`/api/hr/companies/${clientId}/import`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, year, commit }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falhou."); return; }
      if (commit) {
        setFeito(t("imp.done", { criados: j.criados, actualizados: j.actualizados }));
        setP(null); setCsv("");
      } else setP(j);
    } finally { setOcupado(false); }
  }

  async function aoFicheiro(f: File | null) {
    if (!f) return;
    setCsv(await f.text());
    setP(null);
  }

  const bons = (p?.linhas ?? []).filter((l) => !l.erro);
  const maus = (p?.linhas ?? []).filter((l) => l.erro);
  const naoBatem = (p?.linhas ?? []).filter((l) => l.conferencia && !l.conferencia.bate);

  return (
    <div className="p-4">
      <h3 className="font-display text-base font-semibold">{t("imp.title")}</h3>
      <p className="mt-1 max-w-3xl text-[12.5px] text-muted">{t("imp.help")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input type="file" accept=".csv,text/csv,text/plain" className="text-[12.5px]"
          onChange={(e) => aoFicheiro(e.target.files?.[0] ?? null)} />
      </div>
      <textarea
        className="input mt-2 h-32 w-full font-mono text-[11.5px]"
        placeholder={t("imp.paste")}
        value={csv} onChange={(e) => { setCsv(e.target.value); setP(null); }} />

      {erro && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>}
      {feito && <p className="mt-3 rounded-lg border border-ok/40 bg-success-50 px-3 py-2 text-sm">{feito}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn-ghost h-9 px-4 text-sm" disabled={ocupado || !csv.trim()}
          onClick={() => correr(false)}>
          {ocupado ? "…" : t("imp.preview")}
        </button>
        {/*
          Gravar só existe DEPOIS de ver a prévia. Um botão que importa
          directamente é um botão que alguém carrega sem olhar.
        */}
        {p && !!bons.length && (
          <button className="btn-primary h-9 px-4 text-sm" disabled={ocupado}
            onClick={() => correr(true)}>
            {t("imp.commit", { n: bons.length })}
          </button>
        )}
      </div>

      {p && (
        <>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]">
            <span>{t("imp.willCreate", { n: bons.filter((l) => l.acao === "criar").length })}</span>
            <span>{t("imp.willUpdate", { n: bons.filter((l) => l.acao === "actualizar").length })}</span>
            {!!maus.length && <span className="text-danger">{t("imp.willSkip", { n: maus.length })}</span>}
            {!!naoBatem.length && (
              <span className="text-warning">{t("imp.mismatch", { n: naoBatem.length })}</span>
            )}
          </div>

          {!!p.ignoradas.length && (
            <p className="mt-2 text-[12px] text-muted">
              {t("imp.ignored", { cols: p.ignoradas.join(", ") })}
            </p>
          )}

          <div className="-mx-1 mt-3 overflow-x-auto px-1">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-1.5">{t("imp.colLine")}</th>
                  <th className="px-2 py-1.5">{t("imp.colName")}</th>
                  <th className="px-2 py-1.5">{t("imp.colAction")}</th>
                  <th className="px-2 py-1.5 text-right">{t("imp.colYtdGross")}</th>
                  <th className="px-2 py-1.5 text-right">{t("imp.colFilePaye")}</th>
                  <th className="px-2 py-1.5 text-right">{t("imp.colEnginePaye")}</th>
                  <th className="px-2 py-1.5">{t("imp.colCheck")}</th>
                </tr>
              </thead>
              <tbody>
                {p.linhas.map((l) => (
                  <tr key={l.linha} className="border-b border-line/50 align-top">
                    <td className="px-2 py-1.5 font-mono text-muted">{l.linha}</td>
                    <td className="px-2 py-1.5">
                      <span className="font-medium">{l.nome}</span>
                      {l.erro && <p className="text-[11px] text-danger">{l.erro}</p>}
                      {l.avisos.map((a, i) => (
                        <p key={i} className="text-[11px] text-warning">· {a}</p>
                      ))}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={l.acao === "ignorar" ? "chip-danger"
                        : l.acao === "criar" ? "chip-ok" : "chip"}>
                        {t(`imp.act_${l.acao}` as TKey)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {eur(l.dados.ytd_opening_gross_cents)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {l.conferencia ? eur(l.conferencia.payeFicheiro) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {l.conferencia ? eur(l.conferencia.payeMotor) : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      {!l.conferencia ? <span className="text-muted">—</span>
                        : l.conferencia.bate ? <span className="chip-ok">{t("imp.checkOk")}</span>
                          : (
                            <span className="chip-warn" title={`PAYE ${eur(l.conferencia.difPaye)} · USC ${eur(l.conferencia.difUsc)}`}>
                              {t("imp.checkOff", { v: eur(Math.abs(l.conferencia.difPaye)) })}
                            </span>
                          )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!!naoBatem.length && (
            <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px]">
              {t("imp.mismatchHelp")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
