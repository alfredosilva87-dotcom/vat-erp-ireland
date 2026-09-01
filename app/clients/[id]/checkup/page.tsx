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

type Achado = { referencia: string; detalhe: string; href?: string | null; comoResolver?: string };
type Verificacao = {
  id: string; titulo: string; procura: string;
  estado: "ok" | "aviso" | "erro"; resumo: string; achados: Achado[];
};
type Checkup = { correuEm: string; estado: "ok" | "aviso" | "erro"; verificacoes: Verificacao[] };

type ErroDaCarga = { doc: string; erro: string; origem: "purchase" | "sale" | "bank" | "payroll"; id: string };
type Carga = { notas: number; vendas: number; jaEstavam: number; titulos: number; erros: ErroDaCarga[] };

const CHIP = { ok: "chip-ok", aviso: "chip-warn", erro: "chip-danger" } as const;
const BORDA = { ok: "border-l-ok", aviso: "border-l-warning", erro: "border-l-danger" } as const;

export default function CheckupPage({ params }: { params: { id: string } }) {
  const { t } = useT();
  const [d, setD] = useState<Checkup | null>(null);
  const [correndo, setCorrendo] = useState(false);
  /*
   * CONTABILIZAR VIVE AQUI, e não na tela de contabilidade.
   *
   * Pedido do Alfredo, e a lógica é dele: a contabilidade é onde se LÊ o razão;
   * esta tela é onde se pergunta se ele está em dia. O botão que o põe em dia
   * pertence à pergunta, não ao relatório — e quando falha, os erros ficam ao
   * lado das outras verificações que falam do mesmo problema, em vez de a duas
   * telas de distância.
   */
  const [carregando, setCarregando] = useState(false);
  const [carga, setCarga] = useState<Carga | null>(null);
  const [erroDaCarga, setErroDaCarga] = useState<string | null>(null);

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

  async function contabilizar() {
    setCarregando(true); setErroDaCarga(null); setCarga(null);
    try {
      const r = await fetch(`/api/clients/${params.id}/accounting/backfill`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const j = await r.json();
      if (!r.ok) { setErroDaCarga(j.error || t("checkup.postFailed")); return; }
      setCarga(j);
      // A varredura corre logo a seguir: o que a carga arrumou tem de sair
      // desta tela sem obrigar a um segundo clique.
      await correr();
    } finally { setCarregando(false); }
  }

  /** Para onde se vai corrigir cada erro. Ver `OrigemDoErro` no servidor. */
  const caminhoDoErro = (e: ErroDaCarga) =>
    e.origem === "purchase" ? `/invoice/${e.id}`
      : e.origem === "sale" ? `/clients/${params.id}/sales/${e.id}`
      : e.origem === "bank" ? `/clients/${params.id}/bank`
      : `/clients/${params.id}/payable`;

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
        * A AÇÃO em destaque, antes da lista.
        *
        * Ela é o que resolve boa parte do que a lista acusa — documento por
        * contabilizar, título que nunca nasceu, folha sem provisão. Pô-la
        * depois das verificações obrigaria a percorrer tudo para descobrir que
        * havia um botão que arrumava metade delas.
        */}
      <section className="card border-l-4 border-l-brand p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="font-display text-base font-semibold">{t("checkup.postTitle")}</h2>
            <p className="mt-1 text-[12.5px] text-muted">{t("checkup.postHelp")}</p>
          </div>
          <button className="btn-primary h-10 px-5 text-sm" onClick={contabilizar} disabled={carregando}>
            {carregando ? t("common.saving") : t("checkup.postRun")}
          </button>
        </div>

        {erroDaCarga && (
          <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {erroDaCarga}
          </p>
        )}

        {carga && (
          <p className="mt-3 text-sm">
            {t("checkup.postDone", {
              n: carga.notas + carga.vendas, ja: carga.jaEstavam, erros: carga.erros.length,
            })}
          </p>
        )}

        {/*
          * Cada erro leva ao documento que o causou.
          *
          * "1 falhou" não diz qual nem porquê, e o número da nota em texto
          * obriga a ir procurá-la. Com o link, o erro passa a ser um sítio onde
          * se clica — que é a diferença entre uma lista de queixas e uma lista
          * de trabalho.
          */}
        {!!carga?.erros.length && (
          <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-[13px]">
            {carga.erros.map((e, i) => (
              <li key={`${e.id}-${i}`} className="flex flex-wrap gap-x-3">
                <Link className="font-mono text-[12px] font-semibold underline" href={caminhoDoErro(e)}>
                  {e.doc}
                </Link>
                <span className="text-muted">{e.erro}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

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
                  <li key={`${a.referencia}-${i}`}>
                    <div className="flex flex-wrap gap-x-3">
                      {a.href ? (
                        <Link className="font-mono text-[12px] font-semibold underline" href={a.href}>
                          {a.referencia}
                        </Link>
                      ) : (
                        <span className="font-mono text-[12px] font-semibold">{a.referencia}</span>
                      )}
                      <span className="text-muted">{a.detalhe}</span>
                    </div>
                    {/*
                      * O PASSO A PASSO, e não só o diagnóstico.
                      *
                      * Pedido do Alfredo: "esse caminho de mostrar o erro precisa
                      * mostrar como resolve também". Dizer "diferença de 34,20" e
                      * parar aí devolve o problema a quem já sabia que o tinha.
                      * Recuado e em corpo menor de propósito: é a segunda coisa
                      * que se lê, depois de saber qual é o achado.
                      */}
                    {a.comoResolver && (
                      <p className="mt-1 border-l-2 border-brand/40 pl-3 text-[12px] text-muted">
                        {a.comoResolver}
                      </p>
                    )}
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
