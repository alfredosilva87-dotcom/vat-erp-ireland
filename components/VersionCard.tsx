"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * "Em que versão estou, e há coisa nova?"
 *
 * A faixa do topo avisa quando há; isto responde a pergunta a qualquer momento
 * — e é a primeira que se faz ao telefone quando alguma coisa não bate. Sem um
 * sítio onde ela se leia, a resposta era "não sei" dos dois lados da chamada.
 *
 * O botão salta a cache de uma hora, porque quem carrega nele acabou de
 * actualizar e quer confirmar que resultou.
 */
type R = {
  ha: boolean; instalada: string | null; disponivel: string | null; saltoMinor: number;
  estado: string; detalhe: string | null; url: string | null; verificadoEm: string;
};

export default function VersionCard() {
  const { t } = useT();
  const [r, setR] = useState<R | null>(null);
  const [aVerificar, setAVerificar] = useState(false);

  const ler = useCallback(async (forcar: boolean) => {
    setAVerificar(true);
    try {
      const x = await fetch(`/api/updates${forcar ? "?forcar=1" : ""}`, { cache: "no-store" });
      if (x.ok) setR(await x.json());
    } catch { /* offline: o estado abaixo já diz o que se sabe */ }
    finally { setAVerificar(false); }
  }, []);

  useEffect(() => { ler(false); }, [ler]);

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">{t("update.cardTitle")}</h2>
          <p className="mt-1 text-[12.5px] text-muted">{t("update.cardHelp")}</p>
        </div>
        <button className="btn-ghost h-9 px-4 text-sm" disabled={aVerificar} onClick={() => ler(true)}>
          {aVerificar ? t("update.checking") : t("update.checkNow")}
        </button>
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-2 text-sm">
        <div>
          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("update.installed")}</dt>
          <dd className="font-mono font-semibold tabular-nums">{r?.instalada ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("update.published")}</dt>
          <dd className="font-mono font-semibold tabular-nums">{r?.disponivel ?? "—"}</dd>
        </div>
      </dl>

      {r && r.estado !== "ok" && (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px]">
          {r.detalhe}
        </p>
      )}
      {r && r.estado === "ok" && !r.ha && (
        <p className="mt-3 text-[12.5px] text-muted">{t("update.upToDate")}</p>
      )}
      {r && r.ha && (
        <p className="mt-3 rounded-lg border border-brand/40 bg-brand-50 px-3 py-2 text-[12.5px]">
          {t("update.line", { de: r.instalada ?? "—", para: r.disponivel ?? "—" })}{" "}
          {t("update.how")}{" "}
          {r.url && <a className="underline" href={r.url} target="_blank" rel="noreferrer">{t("update.whatChanged")}</a>}
        </p>
      )}
    </section>
  );
}
