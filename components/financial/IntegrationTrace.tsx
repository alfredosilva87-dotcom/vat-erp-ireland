"use client";

import Link from "next/link";
import { eur } from "@/components/financial/tipos";

/**
 * "Esta nota virou o quê?" — respondido na própria nota.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE BLOCO EXISTE
 *
 * A ligação documento → título → razão sempre existiu no banco, mas só se
 * percorria de trás para a frente. Aberta a nota, nada dizia se ela tinha
 * sido contabilizada nem em que conta a pagar ou a receber tinha caído.
 *
 * Quem confere tinha de ir à lista de títulos procurar o número — e o "não
 * encontrei" que às vezes voltava era ambíguo entre três coisas diferentes:
 * não integrou, integrou com outro número, ou procurou-se na lista errada.
 * As três levam a acções diferentes e nenhuma se distingue a olho.
 *
 * É requisito de auditoria antes de ser conveniência.
 * ---------------------------------------------------------------------------
 *
 * O estado NUNCA é um campo gravado na nota: vem calculado dos títulos e do
 * razão (`lib/financial/trace.ts`). Uma marca gravada mente no dia em que o
 * título for apagado ou o lançamento estornado, e uma marca que mente é pior
 * do que marca nenhuma.
 */

export type TituloDoRastro = {
  id: string;
  kind: "payable" | "receivable";
  documentRef: string | null;
  counterparty: string | null;
  dueDate: string | null;
  originalAmount: number;
  chargesAmount: number;
  settledAmount: number;
  outstandingAmount: number;
  status: string;
};

export type Rastro = {
  posted: boolean;
  journalId: string | null;
  postedOn: string | null;
  titles: TituloDoRastro[];
};

const NOME: Record<string, string> = {
  open: "Em aberto", partial: "Parcial", overdue: "Vencido", settled: "Quitado",
};
const CHIP: Record<string, string> = {
  open: "chip", partial: "chip-warn", overdue: "chip-danger", settled: "chip-ok",
};

export default function IntegrationTrace({
  rastro, clientId, origem,
}: {
  rastro: Rastro | null;
  clientId: string;
  origem: "purchase" | "sale";
}) {
  if (!rastro) return null;

  const lado = origem === "purchase" ? "payable" : "receivable";
  const nomeDoLado = origem === "purchase" ? "Contas a pagar" : "Contas a receber";
  const nada = !rastro.posted && rastro.titles.length === 0;

  return (
    <div className="rounded-xl2 border border-line bg-surface-2/40 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-semibold">Integração</h3>
        {rastro.posted ? (
          <p className="text-xs text-muted">
            <span className="chip-ok mr-2">contabilizada</span>
            Lançada no razão em <span className="tnum">{rastro.postedOn}</span>
            {rastro.journalId && (
              <>
                {" · "}
                <Link className="underline" href={`/clients/${clientId}/ledger`}>ver no razão</Link>
              </>
            )}
          </p>
        ) : (
          <p className="text-xs text-muted"><span className="chip mr-2">sem lançamento</span></p>
        )}
      </div>

      {nada ? (
        /*
         * Dizer PORQUE pode não haver nada, e não só que não há.
         *
         * São duas causas com acções opostas: ou o documento ainda não foi
         * contabilizado (resolve-se com o botão), ou este cliente não integra
         * contabilidade (e então não há nada a resolver — é a configuração
         * dele). Um "—" no ecrã manda procurar a diferença nos dois sítios.
         */
        <p className="mt-2 text-sm text-muted">
          Este documento ainda não gerou título nem partida. Ou não foi contabilizado —
          use <strong>Contabilizar</strong> em Contabilidade → Contas — ou este cliente
          não integra contabilidade, em Cadastro → Integrações.
        </p>
      ) : rastro.titles.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Tem partida no razão, mas não abriu título em {nomeDoLado.toLowerCase()} — a
          integração desse módulo está desligada para este cliente.
        </p>
      ) : (
        <table className="mt-2 w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
              <th className="py-1 text-left font-medium">Documento em {nomeDoLado.toLowerCase()}</th>
              <th className="py-1 text-left font-medium">Vencimento</th>
              <th className="py-1 text-right font-medium">Original</th>
              <th className="py-1 text-right font-medium">Pago</th>
              <th className="py-1 text-right font-medium">Em aberto</th>
              <th className="py-1 text-left font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {rastro.titles.map((t) => (
              <tr key={t.id} className="border-b border-line/40">
                <td className="py-1.5">
                  {/*
                    * `status=todos` no link, e não o filtro padrão.
                    *
                    * A lista abre em "pendentes"; um título já quitado não
                    * apareceria, e o rastro levaria a um ecrã vazio — a dizer
                    * que não existe uma coisa que existe.
                    */}
                  <Link
                    className="font-mono text-[12px] underline"
                    href={`/clients/${clientId}/${lado}?status=todos&q=${encodeURIComponent(t.documentRef ?? "")}`}
                  >
                    {t.documentRef || "(sem número)"}
                  </Link>
                  {t.counterparty && <span className="ml-2 text-muted">{t.counterparty}</span>}
                </td>
                <td className="py-1.5 font-mono text-[12px] text-muted">{t.dueDate || "—"}</td>
                <td className="py-1.5 text-right font-mono tabular-nums">{eur(t.originalAmount)}</td>
                <td className="py-1.5 text-right font-mono tabular-nums">{eur(t.settledAmount)}</td>
                <td className="py-1.5 text-right font-mono tabular-nums">{eur(t.outstandingAmount)}</td>
                <td className="py-1.5">
                  <span className={`${CHIP[t.status] ?? "chip"} text-[11px]`}>
                    {NOME[t.status] ?? t.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
