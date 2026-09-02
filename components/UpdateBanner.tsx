"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { useSession } from "@/components/PermissionScope";

/**
 * "Há uma versão nova" — o aviso que a instalação dá a si própria.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NA TELA, E NÃO NUM E-MAIL
 *
 * O ERP corre na máquina do escritório, atrás do firewall deles. Do lado de cá
 * não há forma de saber em que versão cada instalação está, nem de lhes tocar.
 * Quem tem de reparar é quem lá está — e quem lá está só olha para uma coisa:
 * este ecrã.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE AVISO NÃO FAZ
 *
 * Não bloqueia nada, e não se impõe. Fica numa faixa fina, dá para dispensar
 * pela sessão, e volta na sessão seguinte — porque um aviso que se dispensa
 * para sempre é um aviso que se dispensa uma vez e nunca mais se vê, e o mês
 * seguinte apanha a instalação na mesma versão velha.
 *
 * E não avisa nada quando não conseguiu perguntar: falta de credencial ou de
 * rede aparece só ao ADMINISTRADOR, porque é ele que a resolve. Ao operador,
 * um aviso que ele não pode tratar é ruído que o ensina a ignorar a faixa toda.
 */

type Estado = "ok" | "sem-token" | "sem-repo" | "nao-autorizado" | "sem-rede" | "sem-etiquetas";
type Resultado = {
  ha: boolean; instalada: string | null; disponivel: string | null; saltoMinor: number;
  estado: Estado; detalhe: string | null; notas: string | null; url: string | null;
};

const DISPENSADO = "vat-update-banner-dismissed";

export default function UpdateBanner() {
  const { t } = useT();
  const me = useSession();
  const [r, setR] = useState<Resultado | null>(null);
  const [dispensado, setDispensado] = useState(true);

  useEffect(() => {
    try { setDispensado(sessionStorage.getItem(DISPENSADO) === "1"); } catch { setDispensado(false); }
  }, []);

  useEffect(() => {
    if (!me.ready || !me.user) return;
    /*
     * Falha em silêncio de propósito.
     *
     * Um verificador de actualizações que rebenta a tela seria o pior negócio
     * possível: troca uma informação útil por uma avaria real. Se não deu, não
     * se mostra nada.
     */
    fetch("/api/updates", { cache: "no-store" })
      .then((x) => (x.ok ? x.json() : null))
      .then((j) => j && setR(j))
      .catch(() => {});
  }, [me.ready, me.user]);

  if (!r || dispensado) return null;

  const admin = me.user?.role === "admin" || me.user?.role === "master";
  const problema = r.estado !== "ok";

  // Quem não pode resolver não precisa de saber que está partido.
  if (problema && !admin) return null;
  if (!problema && !r.ha) return null;

  function dispensar() {
    setDispensado(true);
    try { sessionStorage.setItem(DISPENSADO, "1"); } catch { /* modo privado */ }
  }

  return (
    <div className={`border-b px-4 py-2 text-[12.5px] sm:px-5 ${
      problema ? "border-warning/40 bg-warning/10" : "border-brand/40 bg-brand-50"
    }`}>
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5">
        {problema ? (
          <>
            <span className="chip-warn">{t("update.cannotCheck")}</span>
            <span className="min-w-0 text-muted">{r.detalhe}</span>
          </>
        ) : (
          <>
            <span className="chip">{t("update.available")}</span>
            <span className="min-w-0">
              {t("update.line", { de: r.instalada ?? "—", para: r.disponivel ?? "—" })}
              {/*
                * O SALTO só aparece quando é grande. "está 8 versões para trás"
                * é a diferença entre adiar e tratar hoje; dizê-lo a quem está
                * uma versão atrás seria dramatizar uma correcção de rotina.
                */}
              {r.saltoMinor >= 3 && (
                <strong className="ml-1">{t("update.behind", { n: r.saltoMinor })}</strong>
              )}
            </span>
            {r.url && (
              <a className="underline" href={r.url} target="_blank" rel="noreferrer">
                {t("update.whatChanged")}
              </a>
            )}
            {admin && <span className="text-muted">{t("update.how")}</span>}
          </>
        )}
        <button className="ml-auto shrink-0 text-muted underline" onClick={dispensar}>
          {t("update.dismiss")}
        </button>
      </div>
    </div>
  );
}
