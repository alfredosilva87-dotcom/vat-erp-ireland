"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT, type TKey } from "@/lib/i18n";
import { eur } from "@/components/financial/tipos";

/**
 * O que ficou de fora de contas a pagar e a receber.
 *
 * A integração falha em silêncio de várias maneiras, e todas se parecem: o
 * documento está gravado, aparece na lista de compras ou de vendas, e não
 * existe em contas a pagar. Sem um sítio que junte as causas, a única forma de
 * descobrir é somar as duas listas à mão.
 *
 * Cada linha diz o MOTIVO, e o motivo diz o que fazer — ver
 * `lib/financial/naoIntegrados.ts`, onde a ordem das causas está explicada.
 */

type Item = {
  id: string;
  origem: "purchase" | "sale";
  documentRef: string | null;
  contraparte: string | null;
  data: string | null;
  valor: number;
  motivo: string;
  meiaIntegracao: boolean;
};

type Resumo = { itens: Item[]; porMotivo: Record<string, number>; meiasIntegracoes: number };

const CHIP: Record<string, string> = {
  por_conferir: "chip-warn",
  integracao_desligada: "chip",
  sem_valor: "chip-danger",
  data_futura: "chip",
  devolvido: "chip-warn",
  // Vermelho, e não amarelo: nos outros o número ainda não conta em lado
  // nenhum. Neste ele já está a contar sem ninguém o ter validado.
  integrado_sem_conferir: "chip-danger",
};

export default function NaoIntegrados({ params }: { params: { id: string } }) {
  const { t } = useT();
  const [d, setD] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`/api/clients/${params.id}/nao-integrados`, { cache: "no-store" });
      if (r.ok) setD(await r.json());
    } finally {
      setCarregando(false);
    }
  }, [params.id]);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{t("unposted.title")}</h1>
          <p className="mt-1 text-muted">{t("unposted.subtitle")}</p>
        </div>
        <button className="btn-ghost h-9 px-4 text-sm" onClick={carregar} disabled={carregando}>
          {t("unposted.recheck")}
        </button>
      </div>

      {/*
        * A meia-integração vem em destaque próprio, acima da lista.
        *
        * É a única causa que não é trabalho por fazer — é um estado partido: o
        * documento está no razão e não na lista, ou o contrário. É exactamente
        * o que faz a conta de controlo deixar de bater com o aging, e o painel
        * de conciliação acusa a diferença sem conseguir dizer de onde vem.
        */}
      {(d?.meiasIntegracoes ?? 0) > 0 && (
        <div className="card border-l-4 border-l-danger p-4">
          <p className="text-sm">
            <span className="chip-danger mr-2">{d!.meiasIntegracoes} · {t("unposted.half")}</span>
            {t("unposted.halfHelp")}
          </p>
        </div>
      )}

      {d && d.itens.length > 0 && (
        <div className="card flex flex-wrap items-center gap-3 p-4">
          {Object.entries(d.porMotivo).map(([m, n]) => (
            <span key={m} className={`${CHIP[m] ?? "chip"} text-[11px]`}>
              {n} · {t(`unposted.${m}` as TKey)}
            </span>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 text-left font-medium">{t("unposted.colDoc")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("unposted.colParty")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("unposted.colDate")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("unposted.colAmount")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("unposted.colReason")}</th>
              </tr>
            </thead>
            <tbody>
              {(d?.itens ?? []).map((i) => (
                <tr key={i.id} className="border-b border-line/50">
                  <td className="px-3 py-2">
                    <Link
                      className="font-mono text-[12px] underline"
                      href={i.origem === "purchase"
                        ? `/invoice/${i.id}`
                        : `/clients/${params.id}/sales/${i.id}`}
                    >
                      {i.documentRef || "—"}
                    </Link>
                    <span className="ml-2 text-[11px] text-muted">
                      {t(`unposted.${i.origem}` as TKey)}
                    </span>
                  </td>
                  <td className="px-3 py-2">{i.contraparte || "—"}</td>
                  <td className="px-3 py-2 font-mono text-[12px] text-muted">{i.data || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(i.valor)}</td>
                  <td className="px-3 py-2">
                    <span className={`${CHIP[i.motivo] ?? "chip"} text-[11px]`}>
                      {t(`unposted.${i.motivo}` as TKey)}
                    </span>
                    {i.meiaIntegracao && (
                      <span className="chip-danger ml-2 text-[11px]">{t("unposted.half")}</span>
                    )}
                  </td>
                </tr>
              ))}
              {!carregando && !(d?.itens ?? []).length && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted">
                    {t("unposted.none")}
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
