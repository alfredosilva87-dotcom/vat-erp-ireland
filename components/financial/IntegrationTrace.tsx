"use client";

import { useState } from "react";
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

export type PartidaDoRastro = {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string | null;
};

export type Rastro = {
  posted: boolean;
  journalId: string | null;
  postedOn: string | null;
  /** As partidas DESTE documento, e só dele. */
  lines: PartidaDoRastro[];
  titles: TituloDoRastro[];
};

const NOME: Record<string, string> = {
  open: "Em aberto", partial: "Parcial", overdue: "Vencido", settled: "Quitado",
};
const CHIP: Record<string, string> = {
  open: "chip", partial: "chip-warn", overdue: "chip-danger", settled: "chip-ok",
};

export default function IntegrationTrace({
  rastro, clientId, origem, documentId, aoDevolver,
}: {
  rastro: Rastro | null;
  clientId: string;
  origem: "purchase" | "sale";
  /** Sem ele não há Devolver — a ação precisa de saber o que devolver. */
  documentId?: string;
  /** Chamado depois de devolver, para a tela recarregar o rastro. */
  aoDevolver?: () => void | Promise<void>;
}) {
  const [devolvendo, setDevolvendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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

      {/*
        * DEVOLVER — o inverso da integração.
        *
        * Vive aqui, ao lado do que desfaz, e não numa tela de administração:
        * quem descobre que o documento está errado está a olhar para ele.
        *
        * Só aparece quando há o que devolver. Um botão sempre visível que na
        * maior parte das vezes responde "não há nada a devolver" ensina a
        * ignorá-lo.
        */}
      {documentId && (rastro.posted || rastro.titles.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="btn-ghost h-8 px-3 text-xs text-danger"
            disabled={devolvendo}
            onClick={async () => {
              if (!confirm(
                "Devolver este documento?\n\n" +
                "Sai de contas a pagar/receber e do razão, e volta ao estado de não integrado. " +
                "O documento em si fica intacto, e pode ser corrigido e contabilizado de novo."
              )) return;
              setDevolvendo(true);
              setErro(null);
              try {
                const r = await fetch(`/api/clients/${clientId}/documents/${documentId}/devolver`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ origem }),
                });
                const j = await r.json();
                // 409 = há baixa ou encargo por desfazer. A mensagem do
                // servidor diz o quê e por que ordem — mostrá-la crua é melhor
                // do que traduzi-la para um "não foi possível".
                if (!r.ok) { setErro(j.error || "Não deu para devolver."); return; }
                await aoDevolver?.();
              } finally {
                setDevolvendo(false);
              }
            }}
          >
            {devolvendo ? "A devolver…" : "Devolver documento"}
          </button>
          <span className="text-xs text-muted">
            Tira de contas a {origem === "purchase" ? "pagar" : "receber"} e do razão, para poder corrigir.
          </span>
        </div>
      )}

      {erro && <p className="mt-2 text-sm text-danger">{erro}</p>}

      {/*
        * O LANÇAMENTO DESTA NOTA, aqui na nota.
        *
        * Até agora, para ver como uma nota tinha sido contabilizada era preciso
        * ir ao título — e lá aparecem TODAS as partidas penduradas nele: a do
        * documento, mais cada baixa, mais cada encargo. Numa nota paga em três
        * vezes são cinco lançamentos, e o da nota é um deles.
        *
        * Aqui é só o dela: a despesa, o VAT a recuperar e o fornecedor a pagar
        * (ou clientes, receita e VAT a pagar, do lado da venda). É a resposta à
        * pergunta que se faz com a nota aberta à frente.
        */}
      {rastro.lines.length > 0 && (
        <div className="-mx-1 overflow-x-auto px-1">
        <table className="mt-3 w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
              <th className="py-1 text-left font-medium">Conta</th>
              <th className="py-1 text-right font-medium">Débito</th>
              <th className="py-1 text-right font-medium">Crédito</th>
            </tr>
          </thead>
          <tbody>
            {rastro.lines.map((l, i) => (
              <tr key={`${l.accountCode}-${i}`} className="border-b border-line/40">
                <td className="py-1.5">
                  <span className="font-mono text-[11.5px] text-muted">{l.accountCode}</span>{" "}
                  {l.accountName}
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums">
                  {l.debit ? eur(l.debit) : ""}
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums">
                  {l.credit ? eur(l.credit) : ""}
                </td>
              </tr>
            ))}
            {/*
              * O somatório fecha a leitura: quem confere um lançamento confere
              * primeiro se ele bate, e fazer essa soma de cabeça em cinco
              * linhas é onde se erra.
              */}
            <tr className="text-[11.5px] font-semibold">
              <td className="py-1.5 text-right text-muted">soma</td>
              <td className="py-1.5 text-right font-mono tabular-nums">
                {eur(rastro.lines.reduce((s, l) => s + l.debit, 0))}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums">
                {eur(rastro.lines.reduce((s, l) => s + l.credit, 0))}
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      )}

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
        <div className="-mx-1 overflow-x-auto px-1">
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
        </div>
      )}
    </div>
  );
}
