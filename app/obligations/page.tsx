"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

/**
 * A agenda fiscal do escritório inteiro.
 *
 * As obrigações sempre existiram, mas uma tela por cliente. Com trinta e cinco
 * empresas, "o que vence esta semana" exigia abrir trinta e cinco telas — e o
 * previsível é que ninguém abrisse nenhuma até chegar carta da Revenue.
 *
 * A pergunta deste painel é a do início do dia: em que cliente tenho de mexer
 * hoje? Por isso ordena por urgência e não por nome — ver lib/fiscal/agenda.ts.
 */

type Semaforo = "vermelho" | "laranja" | "amarelo" | "verde";
type Obrigacao = {
  id: string; tipo: string; periodo: string | null;
  vencimento: string | null; semaforo: Semaforo; diasAteVencer: number | null;
};
type Linha = {
  clientId: string; clientCode: string | null; clientName: string;
  semaforo: Semaforo; atrasadas: number; vencemEm7: number; vencemEm30: number;
  entregues: number; pendentes: Obrigacao[];
};
type Agenda = {
  hoje: string;
  resumo: { clientes: number; comAtraso: number; vencemEm7: number; emDia: number; obrigacoesAtrasadas: number };
  linhas: Linha[];
};

const PONTO: Record<Semaforo, string> = {
  vermelho: "bg-danger", laranja: "bg-warning", amarelo: "bg-warning/50", verde: "bg-success",
};
const CHIP: Record<Semaforo, string> = {
  vermelho: "chip-danger", laranja: "chip-warn", amarelo: "chip-warn", verde: "chip-ok",
};

export default function AgendaFiscal() {
  const { t } = useT();
  const [d, setD] = useState<Agenda | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [soPendentes, setSoPendentes] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/obligations/agenda", { cache: "no-store" });
      if (r.ok) setD(await r.json());
    } finally { setCarregando(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  /*
   * Por omissão esconde quem está em dia.
   *
   * O painel existe para dizer onde mexer. Com trinta e cinco clientes, trinta
   * verdes empurram os cinco que importam para fora do ecrã — e o que fica à
   * vista deixa de ser o trabalho.
   */
  const linhas = (d?.linhas ?? []).filter((l) => !soPendentes || l.semaforo !== "verde");

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{t("agenda.title")}</h1>
          <p className="mt-1 text-muted">{t("agenda.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="accent-brand" checked={soPendentes}
              onChange={(e) => setSoPendentes(e.target.checked)} />
            {t("agenda.onlyPending")}
          </label>
          <button className="btn-ghost h-9 px-4 text-sm" onClick={carregar} disabled={carregando}>
            {t("agenda.refresh")}
          </button>
        </div>
      </div>

      {d && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Cartao rotulo={t("agenda.cardClients")} valor={d.resumo.clientes} />
          <Cartao rotulo={t("agenda.cardLate")} valor={d.resumo.comAtraso} tom="danger"
            nota={t("agenda.cardLateSub", { n: d.resumo.obrigacoesAtrasadas })} />
          <Cartao rotulo={t("agenda.cardWeek")} valor={d.resumo.vencemEm7} tom="warn" />
          <Cartao rotulo={t("agenda.cardOk")} valor={d.resumo.emDia} tom="ok" />
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 text-left font-medium">{t("agenda.colClient")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("agenda.colPending")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("agenda.colLate")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("agenda.colWeek")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("agenda.colMonth")}</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.clientId} className="border-b border-line/50 align-top">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${PONTO[l.semaforo]}`} />
                      <Link className="font-medium underline" href={`/clients/${l.clientId}/obligations`}>
                        {l.clientName}
                      </Link>
                    </span>
                    {l.clientCode && (
                      <span className="ml-4 font-mono text-[11px] text-muted">{l.clientCode}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {l.pendentes.length === 0 ? (
                      <span className="text-muted">{t("agenda.nothingPending")}</span>
                    ) : (
                      <ul className="space-y-1">
                        {l.pendentes.slice(0, 4).map((o) => (
                          <li key={o.id} className="flex flex-wrap items-center gap-2">
                            <span className={`${CHIP[o.semaforo]} text-[10.5px]`}>{o.tipo}</span>
                            {o.periodo && <span className="text-[11px] text-muted">{o.periodo}</span>}
                            <span className="font-mono text-[11px] text-muted">{o.vencimento || "—"}</span>
                            <span className={`text-[11px] ${o.semaforo === "vermelho" ? "text-danger" : "text-muted"}`}>
                              {o.diasAteVencer === null
                                ? t("agenda.noDueDate")
                                : o.diasAteVencer < 0
                                  ? t("agenda.lateBy", { n: -o.diasAteVencer })
                                  : t("agenda.inDays", { n: o.diasAteVencer })}
                            </span>
                          </li>
                        ))}
                        {l.pendentes.length > 4 && (
                          <li className="text-[11px] text-muted">
                            {t("agenda.andMore", { n: l.pendentes.length - 4 })}
                          </li>
                        )}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-danger">
                    {l.atrasadas || ""}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.vencemEm7 || ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{l.vencemEm30 || ""}</td>
                </tr>
              ))}
              {!carregando && !linhas.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted">
                    {soPendentes ? t("agenda.allClear") : t("agenda.none")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Cartao({ rotulo, valor, nota, tom }: {
  rotulo: string; valor: number; nota?: string; tom?: "danger" | "warn" | "ok";
}) {
  const cor = tom === "danger" ? "text-danger" : tom === "warn" ? "text-warning" : tom === "ok" ? "text-success" : "";
  return (
    <div className="card p-5">
      <div className={`font-display text-2xl font-semibold tnum ${valor > 0 ? cor : ""}`}>{valor}</div>
      <div className="mt-0.5 text-sm text-muted">{rotulo}</div>
      {nota && <div className="mt-1 text-xs text-muted">{nota}</div>}
    </div>
  );
}
