"use client";

import { useMemo, useState } from "react";
import { useT, type TKey } from "@/lib/i18n";
import { currentIsoWeek } from "@/lib/hr/payroll";

/**
 * FECHAR A FOLHA DE VÁRIAS EMPRESAS DE UMA VEZ.
 *
 * ---------------------------------------------------------------------------
 * O TRABALHO É POR SEXTA-FEIRA, E NÃO POR CLIENTE
 *
 * Quem corre a folha não pensa "a folha da Cork Tech": pensa "a folha da semana
 * 36", que são as empresas todas do bloco semanal. Uma a uma são trinta e cinco
 * separadores e trinta e cinco selecções do mesmo período — e é aí que uma fica
 * por fechar, para se descobrir um mês depois.
 *
 * ---------------------------------------------------------------------------
 * O RELATÓRIO É A SAÍDA, E NÃO UM EXTRA
 *
 * Cada empresa devolve linha própria, inclusive quando não se fez nada. Um lote
 * que diz só "12 fechadas" obriga a conferir as doze à mão para descobrir qual
 * é a décima terceira que não entrou — e quem confere uma vez deixa de conferir.
 */

type Empresa = {
  id: string; name: string; client_code: string | null;
  employee_count: number; status?: string | null;
  freq_weekly?: boolean; freq_fortnightly?: boolean; freq_monthly?: boolean;
};

type Titulo = {
  tipo: string; id: string | null; jaExistia: boolean; valorCents: number;
  ignorado?: { codigo: string; params?: Record<string, string | number> };
};
type Resultado = {
  clientId: string; nome: string; codigo: string; gravados: number;
  titulos: Titulo[];
  recado?: { codigo: string; params?: Record<string, string | number> };
};

const eur = (c: number) =>
  (c / 100).toLocaleString("en-IE", { style: "currency", currency: "EUR" });

const FREQS = ["weekly", "fortnightly", "monthly"] as const;
type Freq = (typeof FREQS)[number];

const ROTULO: Record<Freq, TKey> = {
  weekly: "hr.freqWeekly", fortnightly: "hr.freqFortnightly", monthly: "hr.freqMonthly",
};

export default function PayrollBatch({ companies, year }: { companies: Empresa[]; year: number }) {
  const { t } = useT();
  const [freq, setFreq] = useState<Freq>("weekly");
  const maxPeriodo = freq === "weekly" ? 53 : freq === "fortnightly" ? 27 : 12;
  const [periodo, setPeriodo] = useState(() => Math.min(currentIsoWeek(), 53));
  const [escolhidas, setEscolhidas] = useState<Record<string, boolean>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);

  /*
   * Só entram as empresas que correm ESTE bloco e que têm gente.
   *
   * Uma empresa sem funcionários no bloco devolvia sempre "ninguém para pagar":
   * ruído garantido em todas as corridas, que ensina a não ler o relatório.
   */
  const elegiveis = useMemo(() => companies.filter((c) => {
    const liga = freq === "weekly" ? c.freq_weekly
      : freq === "fortnightly" ? c.freq_fortnightly : c.freq_monthly;
    return !!liga && c.employee_count > 0 && c.status !== "Inactive";
  }), [companies, freq]);

  const marcadas = elegiveis.filter((c) => escolhidas[c.id]);
  const todas = elegiveis.length > 0 && marcadas.length === elegiveis.length;

  function trocarFreq(f: Freq) {
    setFreq(f);
    // A selecção não sobrevive à troca de bloco: as empresas são outras, e uma
    // marca herdada mandaria fechar uma folha que ninguém escolheu.
    setEscolhidas({});
    setResultados(null);
    const semana = currentIsoWeek();
    setPeriodo(f === "weekly" ? Math.min(semana, 53)
      : f === "fortnightly" ? Math.min(Math.ceil(semana / 2), 27)
      : new Date().getMonth() + 1);
  }

  async function correr() {
    // Fechar é irreversível na prática: os recibos passam a definitivos e as
    // contas a pagar entram na lista. Confirmar com o NÚMERO à frente é o que
    // trava o clique dado com o bloco errado seleccionado.
    if (!window.confirm(t("lote.confirmar", { n: marcadas.length, p: periodo }))) return;
    setOcupado(true); setErro(null); setResultados(null);
    try {
      const r = await fetch("/api/hr/payroll-batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year, period: periodo, freq, clientIds: marcadas.map((c) => c.id),
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falhou."); return; }
      setResultados(j.resultados ?? []);
    } catch (e: any) {
      setErro(e?.message || "Falhou.");
    } finally { setOcupado(false); }
  }

  function contar(res: Resultado): string {
    const partes: string[] = [];
    if (res.gravados) partes.push(t("lote.gravados", { n: res.gravados }));
    for (const u of res.titulos) {
      const nome = t(`titulo.${u.tipo}` as TKey);
      if (u.id) partes.push(`${nome} ${eur(u.valorCents)}${u.jaExistia ? " ·" : ""}`);
      else if (u.ignorado) partes.push(`${nome}: ${t(u.ignorado.codigo as TKey, u.ignorado.params)}`);
    }
    if (res.recado) partes.push(t(res.recado.codigo as TKey, res.recado.params));
    return partes.join(" · ") || "—";
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line bg-surface-2/60 px-4 py-2.5">
        <h2 className="font-display text-sm font-semibold">{t("lote.title")}</h2>
        <p className="mt-0.5 max-w-4xl text-[12.5px] text-muted">{t("lote.help")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 px-4 py-3">
        <label className="flex flex-col leading-tight">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">
            {t("hr.colPayslipType")}
          </span>
          <select className="input mt-1 h-9 w-auto cursor-pointer py-0 text-[13px] font-semibold"
            value={freq} onChange={(e) => trocarFreq(e.target.value as Freq)}>
            {FREQS.map((f) => <option key={f} value={f}>{t(ROTULO[f])}</option>)}
          </select>
        </label>
        <label className="flex flex-col leading-tight">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">
            {t("run.period")}
          </span>
          <select className="input mt-1 h-9 w-auto cursor-pointer py-0 text-[13px] font-semibold"
            value={Math.min(periodo, maxPeriodo)} onChange={(e) => setPeriodo(Number(e.target.value))}>
            {Array.from({ length: maxPeriodo }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <button className="btn-primary mb-0.5 h-9 px-4 text-sm"
          disabled={ocupado || !marcadas.length} onClick={correr}>
          {ocupado ? "…" : t("lote.correr", { n: marcadas.length })}
        </button>
      </div>

      {erro && <p className="px-4 pb-2 text-sm text-danger">{erro}</p>}

      {!elegiveis.length ? (
        <p className="px-4 pb-4 text-[12.5px] text-muted">{t("lote.nenhuma")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-[13px]">
            <thead>
              <tr className="border-y border-line text-left text-[10px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 cursor-pointer" checked={todas}
                      onChange={(e) => setEscolhidas(e.target.checked
                        ? Object.fromEntries(elegiveis.map((c) => [c.id, true]))
                        : {})} />
                    {t("lote.colCompany")}
                  </label>
                </th>
                <th className="px-4 py-2 text-right font-medium">{t("hr.colStaff")}</th>
                <th className="px-4 py-2 font-medium">{t("lote.colResult")}</th>
              </tr>
            </thead>
            <tbody>
              {elegiveis.map((c) => {
                const res = resultados?.find((r) => r.clientId === c.id);
                return (
                  <tr key={c.id} className="border-b border-line/70 align-top">
                    <td className="px-4 py-2">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="checkbox" className="h-4 w-4 cursor-pointer"
                          checked={!!escolhidas[c.id]}
                          onChange={(e) => setEscolhidas((m) => ({ ...m, [c.id]: e.target.checked }))} />
                        <span className="font-medium">{c.name}</span>
                        <span className="font-mono text-[11px] text-muted">{c.client_code}</span>
                      </label>
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-muted">
                      {c.employee_count}
                    </td>
                    <td className={`px-4 py-2 text-[12.5px] ${res?.recado ? "text-warning" : "text-muted"}`}>
                      {res ? contar(res) : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
