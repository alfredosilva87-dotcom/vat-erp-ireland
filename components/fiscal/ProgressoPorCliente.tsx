"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * Quanto de cada cliente já está entregue — uma barra por cliente.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA BARRA MOSTRA QUE A TABELA NÃO MOSTRAVA
 *
 * A tabela abaixo responde "o que falta". Esta secção responde outra coisa: **em
 * que ponto está cada cliente**. São perguntas diferentes e a segunda não se
 * consegue responder lendo uma lista de pendências — é preciso ver o entregue
 * ao lado do total.
 *
 * Um cliente com 2 atrasos em 3 obrigações e um com 2 em 40 aparecem iguais numa
 * coluna de contagem, e são casos completamente diferentes.
 * ---------------------------------------------------------------------------
 *
 * Só aparecem os clientes que TÊM obrigações. Uma barra vazia de um cliente sem
 * nada registado não é informação — é uma linha a dizer que o cadastro está por
 * fazer, e isso pertence a outro ecrã.
 */

type Linha = {
  clientId: string; clientCode: string | null; clientName: string;
  atrasadas: number; vencemEm7: number; vencemEm30: number; entregues: number;
  pendentes: unknown[];
};

const MOSTRA_DE_INICIO = 8;

export default function ProgressoPorCliente({ linhas }: { linhas: Linha[] }) {
  const { t } = useT();
  const [tudo, setTudo] = useState(false);

  const comObrigacoes = linhas
    .map((l) => ({ ...l, total: l.entregues + l.pendentes.length }))
    .filter((l) => l.total > 0)
    // Quem tem mais atraso primeiro, e a seguir quem tem menos entregue: é a
    // mesma ordem de urgência da tabela, para os dois blocos não se
    // contradizerem quando se olha de um para o outro.
    .sort((a, b) => (b.atrasadas - a.atrasadas)
      || (a.entregues / a.total) - (b.entregues / b.total));

  if (!comObrigacoes.length) return null;

  const visiveis = tudo ? comObrigacoes : comObrigacoes.slice(0, MOSTRA_DE_INICIO);

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-semibold">{t("agenda.progressTitle")}</h2>
        <p className="text-xs text-muted">
          {t("agenda.progressHint")}
        </p>
      </div>

      <div className="mt-3 space-y-2.5">
        {visiveis.map((l) => {
          const pendentes = l.pendentes.length;
          const pctEntregue = (l.entregues / l.total) * 100;
          const pctAtraso = (l.atrasadas / l.total) * 100;
          const pctResto = 100 - pctEntregue - pctAtraso;

          return (
            <div key={l.clientId} className="flex items-center gap-3">
              <Link
                className="w-44 shrink-0 truncate text-[12.5px] underline"
                href={`/clients/${l.clientId}/obligations`}
                title={l.clientName}
              >
                {l.clientCode && <span className="font-mono text-[11px] text-muted">{l.clientCode} </span>}
                {l.clientName}
              </Link>

              {/*
                * Uma barra com TRÊS faixas, e não duas.
                *
                * Entregue, atrasado, e o que ainda está dentro do prazo. Juntar
                * as duas últimas pintaria de vermelho uma obrigação que só vence
                * daqui a três semanas — e um vermelho que não é urgente ensina a
                * ignorar o vermelho que é.
                */}
              <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div className="bg-ok" style={{ width: `${pctEntregue}%` }} />
                <div className="bg-danger" style={{ width: `${pctAtraso}%` }} />
                <div className="bg-line" style={{ width: `${pctResto}%` }} />
              </div>

              <span className="w-20 shrink-0 text-right font-mono text-[11.5px] tabular-nums text-muted">
                {l.entregues}/{l.total}
              </span>
              {/*
                * Largura suficiente para o chip NÃO partir em duas linhas.
                *
                * Com `w-16` saía "13" numa linha e "atrasadas" na seguinte, e
                * uma lista de barras com alturas diferentes lê-se pior do que
                * uma lista alinhada — o olho perde a horizontal.
                */}
              <span className="w-28 shrink-0 whitespace-nowrap text-right text-[11px]">
                {l.atrasadas > 0
                  ? <span className="chip-danger text-[10px]">{t("agenda.nLate", { n: String(l.atrasadas) })}</span>
                  : pendentes > 0
                    ? <span className="text-muted">{t("agenda.nPending", { n: String(pendentes) })}</span>
                    : <span className="chip-ok text-[10px]">em dia</span>}
              </span>
            </div>
          );
        })}
      </div>

      {comObrigacoes.length > MOSTRA_DE_INICIO && (
        <button className="btn-ghost mt-3 h-8 px-3 text-xs" onClick={() => setTudo(!tudo)}>
          {tudo
            ? "mostrar menos"
            : `ver os outros ${comObrigacoes.length - MOSTRA_DE_INICIO}`}
        </button>
      )}
    </section>
  );
}
