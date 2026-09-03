"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

/**
 * O quadro cliente × obrigação: uma coluna por declaração, um sinal em cada.
 *
 * ---------------------------------------------------------------------------
 * A PERGUNTA QUE SÓ ESTE FORMATO RESPONDE
 *
 * A tabela da agenda é por CLIENTE: abre-se um e vê-se o que lhe falta. Esta
 * lê-se ao contrário — por COLUNA — e responde "o VAT3 deste período já está
 * entregue em toda a gente?".
 *
 * É a pergunta de quem fecha um prazo. No dia 19, o que interessa não é o
 * cliente A ou o B: é encontrar, numa vista de olhos, os três em que a coluna
 * do VAT3 ainda não está verde. Numa tabela por cliente isso obriga a ler
 * trinta e cinco linhas até ao fim.
 * ---------------------------------------------------------------------------
 *
 * As colunas saem DOS DADOS e não de uma lista fixa: o escritório cria
 * obrigações à mão, e uma lista fixa deixaria essas de fora — invisíveis
 * justamente no ecrã que existe para não deixar passar nada.
 */

type Obrigacao = {
  id: string; tipo: string; periodo: string | null;
  vencimento: string | null; semaforo: "vermelho" | "laranja" | "amarelo" | "verde";
  diasAteVencer: number | null;
};
type Linha = {
  clientId: string; clientCode: string | null; clientName: string;
  semaforo: "vermelho" | "laranja" | "amarelo" | "verde";
  atrasadas: number; entregues: number; pendentes: Obrigacao[];
};

/** O pior estado de um cliente numa dada obrigação. */
type Estado = "atrasada" | "vence" | "prazo" | "nenhuma";

const SINAL: Record<Estado, { d: string; classe: string; titulo: string }> = {
  // Um X para o atraso, um ! para o que vence já, um relógio para o que espera,
  // e um traço para o que não tem nada pendente. Formas diferentes e não só
  // cores diferentes: um em cada doze homens não distingue o vermelho do verde,
  // e este quadro seria ilegível para essa pessoa se a cor fosse o único sinal.
  atrasada: { d: "M7 7l6 6M13 7l-6 6", classe: "text-danger", titulo: "atrasada" },
  vence: { d: "M10 5.5v5M10 13.6v.2", classe: "text-warning", titulo: "vence nos próximos dias" },
  prazo: { d: "M10 5.6v4.6l3 1.8", classe: "text-muted", titulo: "dentro do prazo" },
  /*
   * Sem pendência desenha um TRAÇO, e não um visto.
   *
   * A agenda só devolve o que está POR ENTREGAR. Um cliente que já entregou e um
   * que nunca teve esta obrigação chegam aqui exactamente iguais, e não há como
   * separá-los com o que a rota manda. Um visto verde diria que um sole trader
   * entregou o CT1 — que ele nem devia ter — e é um erro que ninguém vai
   * conferir, porque verde não se confere.
   *
   * O traço diz "nada a tratar aqui", que é a única coisa que se sabe mesmo.
   */
  nenhuma: { d: "M6.5 10h7", classe: "text-muted opacity-40", titulo: "nada pendente" },
};

export default function QuadroDeObrigacoes({ linhas }: { linhas: Linha[] }) {
  const { t } = useT();
  const { colunas, grelha } = useMemo(() => {
    const tipos = new Set<string>();
    for (const l of linhas) for (const o of l.pendentes) tipos.add(o.tipo);

    /*
     * Os tipos conhecidos vêm primeiro e por ordem de calendário; os criados à
     * mão vêm a seguir, por ordem alfabética. Ordenar tudo alfabeticamente
     * poria "RTD" antes de "VAT3", que é o contrário da ordem em que se
     * trabalha neles.
     */
    const ORDEM = ["VAT3", "RTD", "CT1", "FORM11", "B1", "PRELIMINARY_TAX"];
    const colunas = [...tipos].sort((a, b) => {
      const ia = ORDEM.indexOf(a), ib = ORDEM.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });

    const grelha = linhas.map((l) => {
      const porTipo: Record<string, { estado: Estado; o?: Obrigacao }> = {};
      for (const tipo of colunas) {
        const dela = l.pendentes.filter((o) => o.tipo === tipo);
        if (!dela.length) {
          // Ver o comentário em SINAL.nenhuma: aqui não se sabe se foi entregue
          // ou se nunca existiu, e o desenho não pode fingir que sabe.
          porTipo[tipo] = { estado: "nenhuma" };
          continue;
        }
        const pior = dela.reduce((p, o) =>
          (o.semaforo === "vermelho" ? o
            : p.semaforo === "vermelho" ? p
              : o.semaforo === "laranja" ? o : p), dela[0]);
        porTipo[tipo] = {
          estado: pior.semaforo === "vermelho" ? "atrasada"
            : pior.semaforo === "laranja" ? "vence" : "prazo",
          o: pior,
        };
      }
      return { linha: l, porTipo, temAlguma: l.pendentes.length > 0 };
    });

    return { colunas, grelha };
  }, [linhas]);

  if (!colunas.length) return null;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="font-display text-sm font-semibold">{t("agenda.gridTitle")}</h2>
        <p className="text-xs text-muted">
          {t("agenda.gridHint")}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="row-hover w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2 text-left font-medium">{t("agenda.colClient")}</th>
              {colunas.map((c) => (
                <th key={c} className="px-2 py-2 text-center font-medium">{c}</th>
              ))}
              <th className="px-3 py-2 text-left font-medium">{t("agenda.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {grelha.map(({ linha: l, porTipo }) => (
              <tr key={l.clientId} className="border-b border-line/50">
                <td className="px-3 py-2">
                  <Link className="underline" href={`/clients/${l.clientId}/obligations`}>
                    {l.clientName}
                  </Link>
                  {l.clientCode && (
                    <span className="ml-2 font-mono text-[11px] text-muted">{l.clientCode}</span>
                  )}
                </td>
                {colunas.map((c) => {
                  const cel = porTipo[c];
                  const s = SINAL[cel.estado];
                  const titulo = cel.o
                    ? `${c}${cel.o.periodo ? ` · ${cel.o.periodo}` : ""} — ${s.titulo}`
                      + `${cel.o.vencimento ? ` (vence ${cel.o.vencimento})` : ""}`
                    : `${c} — sem pendência`;
                  return (
                    <td key={c} className="px-2 py-2 text-center">
                      <span title={titulo} className={`inline-flex ${s.classe}`}>
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-label={titulo}>
                          <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.3" opacity=".28" />
                          <path d={s.d} stroke="currentColor" strokeWidth="1.9"
                            strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </td>
                  );
                })}
                <td className="px-3 py-2">
                  {l.atrasadas > 0
                    ? <span className="chip-danger text-[11px]">{t("agenda.stMissing")}</span>
                    : l.pendentes.length > 0
                      ? <span className="chip-warn text-[11px]">{t("agenda.stDue")}</span>
                      : <span className="chip-ok text-[11px]">{t("agenda.stOk")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
