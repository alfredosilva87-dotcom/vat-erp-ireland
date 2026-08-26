"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

/**
 * A varredura a pedido: "posso confiar nos números deste cliente?"
 *
 * Junta num sítio o que hoje está espalhado por três telas, mais os estados
 * que não aparecem em sítio nenhum — como o título cujo documento foi apagado,
 * que some das duas listas ao mesmo tempo e deixa a conta de controlo a fechar
 * na mesma, porque os dois lados ficaram órfãos juntos.
 *
 * Ver `lib/accounting/inconsistencias.ts` para o que cada verificação procura
 * e para a regra que as governa: distinguir defeito de configuração.
 */

type Achado = { referencia: string; detalhe: string; href?: string | null };
type Verificacao = {
  id: string; titulo: string; procura: string;
  estado: "ok" | "aviso" | "erro"; resumo: string; achados: Achado[];
};
type Checkup = { correuEm: string; estado: "ok" | "aviso" | "erro"; verificacoes: Verificacao[] };

const CHIP = { ok: "chip-ok", aviso: "chip-warn", erro: "chip-danger" } as const;
const BORDA = { ok: "border-l-ok", aviso: "border-l-warning", erro: "border-l-danger" } as const;

export default function CheckupPage({ params }: { params: { id: string } }) {
  const { t } = useT();
  const [d, setD] = useState<Checkup | null>(null);
  const [correndo, setCorrendo] = useState(false);

  const correr = useCallback(async () => {
    setCorrendo(true);
    try {
      const r = await fetch(`/api/clients/${params.id}/checkup`, { cache: "no-store" });
      if (r.ok) setD(await r.json());
    } finally {
      setCorrendo(false);
    }
  }, [params.id]);

  useEffect(() => { correr(); }, [correr]);

  const problemas = (d?.verificacoes ?? []).filter((v) => v.estado !== "ok");

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{t("checkup.title")}</h1>
          <p className="mt-1 text-muted">{t("checkup.subtitle")}</p>
        </div>
        <button className="btn-primary h-9 px-4 text-sm" onClick={correr} disabled={correndo}>
          {correndo ? t("checkup.running") : t("checkup.run")}
        </button>
      </div>

      {d && (
        <div className={`card border-l-4 p-4 ${BORDA[d.estado]}`}>
          <p className="text-sm">
            <span className={`${CHIP[d.estado]} mr-2`}>
              {d.estado === "ok" ? t("checkup.allGood") : `${problemas.length} ${t("checkup.toLookAt")}`}
            </span>
            {d.estado === "ok"
              ? t("checkup.allGoodHelp")
              : t("checkup.problemsHelp")}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t("checkup.ranAt")} {new Date(d.correuEm).toLocaleString("pt-PT")}
          </p>
        </div>
      )}

      {/*
        * Os problemas primeiro, e o que está bem a seguir.
        *
        * Uma lista por ordem fixa faz a pessoa percorrer sete caixas verdes até
        * achar a vermelha. E as verdes ficam na mesma — dizer "verifiquei isto
        * e está bem" é resultado, não enchimento: sem elas, não se sabe se a
        * rotina olhou.
        */}
      <div className="space-y-3">
        {[...problemas, ...(d?.verificacoes ?? []).filter((v) => v.estado === "ok")].map((v) => (
          <section key={v.id} className={`card border-l-4 p-5 ${BORDA[v.estado]}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-base font-semibold">{v.titulo}</h2>
              <span className={`${CHIP[v.estado]} text-[11px]`}>{v.estado}</span>
            </div>
            <p className="mt-0.5 text-xs text-muted">{v.procura}</p>
            <p className="mt-2 text-sm">{v.resumo}</p>

            {v.achados.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-[13px]">
                {v.achados.map((a, i) => (
                  <li key={`${a.referencia}-${i}`} className="flex flex-wrap gap-x-3">
                    {a.href ? (
                      <Link className="font-mono text-[12px] font-semibold underline" href={a.href}>
                        {a.referencia}
                      </Link>
                    ) : (
                      <span className="font-mono text-[12px] font-semibold">{a.referencia}</span>
                    )}
                    <span className="text-muted">{a.detalhe}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {!d && !correndo && <p className="card p-6 text-muted">{t("checkup.none")}</p>}
    </div>
  );
}
