"use client";

import { useState } from "react";
import { useT, type TKey } from "@/lib/i18n";

/**
 * O ENSAIO da Revenue — e o painel que não deixa ninguém confundi-lo.
 *
 * ---------------------------------------------------------------------------
 * ISTO SÓ APARECE EM CLIENTES DE DEMONSTRAÇÃO
 *
 * A página só o monta quando o código do cliente começa por `DEMO-` — e o
 * servidor recusa na mesma, porque uma trava que só existe no ecrã não é uma
 * trava. Estar aqui em duplicado é de propósito: o ecrã evita a pergunta, o
 * servidor evita o estrago.
 *
 * O aspecto é deliberadamente o de um aviso e não o de uma funcionalidade. Um
 * painel bonito no meio dos outros ensina que semear dado fiscal falso é uma
 * operação normal — e não é.
 */

type Resposta = {
  feitos?: { quem: string; rpn: string }[];
  saltados?: { quem: string; codigo: string }[];
  apagados?: number;
};

export default function EnsaioRevenue({ clientId, year }: { clientId: string; year: number }) {
  const { t } = useT();
  const [comAcumulado, setComAcumulado] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [r, setR] = useState<Resposta | null>(null);

  async function correr(acao: "semear" | "limpar") {
    if (acao === "semear" && !window.confirm(t("ensaio.confirmar", { ano: year }))) return;
    setOcupado(true); setErro(null); setR(null);
    try {
      const resp = await fetch(`/api/hr/companies/${clientId}/revenue-rehearsal`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        // A palavra por extenso vai no pedido: ver a rota. Um POST disparado por
        // engano noutro sítio não a traz, e por isso não semeia nada.
        body: JSON.stringify({ acao, year, comAcumulado, confirmar: "ENSAIO" }),
      });
      const j = await resp.json();
      if (!resp.ok) {
        setErro(j.codigo ? t(j.codigo as TKey, j.params) : (j.error || "Falhou."));
        return;
      }
      setR(j);
    } finally { setOcupado(false); }
  }

  return (
    <div className="mt-6 rounded-xl2 border border-warning/50 bg-warning/10 p-4">
      <h3 className="font-display text-sm font-semibold">{t("ensaio.title")}</h3>
      <p className="mt-1 max-w-4xl text-[12.5px]">{t("ensaio.help")}</p>
      <p className="mt-1 max-w-4xl text-[12px] text-muted">{t("ensaio.travas")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px]"
          title={t("ensaio.acumuladoHelp")}>
          <input type="checkbox" className="h-4 w-4 cursor-pointer" checked={comAcumulado}
            onChange={(e) => setComAcumulado(e.target.checked)} />
          {t("ensaio.acumulado")}
        </label>
        <button className="btn-ghost h-8 px-3 text-xs" disabled={ocupado}
          onClick={() => correr("semear")}>
          {ocupado ? "…" : t("ensaio.semear")}
        </button>
        <button className="btn-ghost h-8 px-3 text-xs text-danger" disabled={ocupado}
          onClick={() => correr("limpar")}>
          {t("ensaio.limpar")}
        </button>
      </div>

      {erro && <p className="mt-2 text-sm text-danger">{erro}</p>}

      {r && (
        <div className="mt-3 space-y-1 text-[12.5px]">
          {r.apagados !== undefined && <p>{t("ensaio.apagados", { n: r.apagados })}</p>}
          {!!r.feitos?.length && (
            <p>{t("ensaio.semeados", {
              n: r.feitos.length,
              quais: r.feitos.map((f) => `${f.quem} (${f.rpn})`).join(", "),
            })}</p>
          )}
          {/* O que NÃO se semeou tem de aparecer, senão a contagem mente por
              omissão: quem semeia conta as linhas e não sabe que falta uma. */}
          {r.saltados?.map((s, i) => (
            <p key={i} className="text-muted">· {s.quem}: {t(s.codigo as TKey)}</p>
          ))}
        </div>
      )}
    </div>
  );
}
