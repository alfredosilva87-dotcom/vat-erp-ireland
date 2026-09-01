"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

/**
 * Quem está a passar o limiar de registo de VAT.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO VIVE NO PAINEL DE OBRIGAÇÕES E NÃO NO CLIENTE
 *
 * Uma versão por cliente só serve quem já abriu o cliente — e quem já suspeita
 * já foi ver. O caso que custa dinheiro é o outro: a empresa em que ninguém
 * está a pensar, que passou os €42.500 em março e continua a faturar sem IVA.
 *
 * É também o único alerta desta tela com preço em euros. Os prazos custam
 * coima, que tem tabela; este custa o IVA das vendas já feitas — dinheiro que
 * o cliente recebeu sem o cobrar, e que sai do bolso dele.
 * ---------------------------------------------------------------------------
 *
 * Carrega SOZINHO, depois da agenda. A varredura lê as vendas de doze meses de
 * cada cliente não registado, e pendurá-la na mesma chamada faria a agenda —
 * que se abre todos os dias — esperar por ela.
 */

type Linha = {
  clientId: string; clientCode: string | null; clientName: string;
  faturamento: number; usoDoMenorLimiar: number;
  estado: "passou" | "aproxima";
  /*
   * A frase vem do MOTIVO e não do servidor.
   *
   * A rota devolve uma `mensagem` pronta, mas em português fixo — e esta tela
   * pode estar em inglês. O motivo é um código; a frase monta-se aqui, na
   * língua de quem está a ler.
   */
  motivo: "aproxima" | "passouServicos" | "passouAmbos";
  limiarServicos: number; limiarBens: number;
};

const eur = (n: number) =>
  n.toLocaleString("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
/** Só o número, para as frases que já trazem o € escrito. */
const milhar = (n: number) => n.toLocaleString("en-IE");

export default function LimiarVat() {
  const { t } = useT();
  const [d, setD] = useState<{ linhas: Linha[]; clientesOlhados: number; desde: string; ate: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/obligations/vat-threshold")
      .then((r) => r.json())
      .then((j) => { if (vivo) { if (j.error) setErro(j.error); else setD(j); } })
      .catch(() => { if (vivo) setErro(t("vatLimit.readErr")); });
    return () => { vivo = false; };
  }, []);

  if (erro) return <p className="text-sm text-danger">{erro}</p>;

  /*
   * Enquanto carrega, e quando não há nada, NÃO ocupa espaço com uma caixa
   * vazia. Uma secção permanente que diz "está tudo bem" todos os dias treina
   * o olho a saltá-la — e no dia em que tiver conteúdo, salta-se na mesma.
   */
  if (!d || d.linhas.length === 0) return null;

  const passaram = d.linhas.filter((l) => l.estado === "passou");
  // Os limiares vêm nas linhas, e não numa constante da tela: se a lei mudar,
  // muda em lib/fiscal/formaJuridica.ts e chega aqui sozinha.
  const limiares = {
    servicos: d.linhas[0]?.limiarServicos ?? 0,
    bens: d.linhas[0]?.limiarBens ?? 0,
  };

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-semibold">
          {t("vatLimit.title")}
          {passaram.length > 0 && (
            <span className="chip-danger ml-2 text-[11px]">
              {t("vatLimit.passedChip", { n: passaram.length })}
            </span>
          )}
        </h2>
        <p className="text-xs text-muted">
          {t("vatLimit.window", { de: d.desde, ate: d.ate, n: d.clientesOlhados })}
        </p>
      </div>

      <p className="mt-1 text-xs text-muted">
        {t("vatLimit.why", { servicos: milhar(limiares.servicos), bens: milhar(limiares.bens) })}
      </p>

      <div className="-mx-1 overflow-x-auto px-1">
      <table className="mt-3 w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
            <th className="py-1 text-left font-medium">{t("vatLimit.colClient")}</th>
            <th className="py-1 text-right font-medium">{t("vatLimit.col12m")}</th>
            <th className="py-1 text-right font-medium">{t("vatLimit.colUse")}</th>
            <th className="py-1 text-left font-medium">{t("vatLimit.colState")}</th>
          </tr>
        </thead>
        <tbody>
          {d.linhas.map((l) => (
            <tr key={l.clientId} className="border-b border-line/40">
              <td className="py-1.5">
                <Link className="underline" href={`/clients/${l.clientId}/settings`}>
                  {l.clientCode && <span className="font-mono text-[11.5px] text-muted">{l.clientCode} </span>}
                  {l.clientName}
                </Link>
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums">{eur(l.faturamento)}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">{l.usoDoMenorLimiar}%</td>
              <td className="py-1.5">
                <span className={`${l.estado === "passou" ? "chip-danger" : "chip-warn"} text-[11px]`}>
                  {t(l.estado === "passou" ? "vatLimit.chipPassed" : "vatLimit.chipNear")}
                </span>
                <span className="ml-2 text-xs text-muted">
                  {t(`vatLimit.${l.motivo}` as const, {
                    n: l.usoDoMenorLimiar,
                    servicos: milhar(l.limiarServicos),
                    bens: milhar(l.limiarBens),
                  })}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}
