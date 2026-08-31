"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * Lançar um título À MÃO, sem documento por trás.
 *
 * Taxa do CRO, seguro por débito directo, multa da Revenue, um acerto com o
 * fornecedor. Dívida que existe e não tem nota fiscal.
 *
 * Sem isto havia duas saídas, ambas más: deixar de fora da lista — e aí
 * "quanto devo" mente por omissão — ou inventar uma nota de compra para a
 * acomodar, que é pior, porque entra na apuração de VAT como se fosse compra.
 *
 * A partida está em `postManualTitle`; aqui só se recolhe o que ela precisa.
 */

type Conta = { code: string; description: string; type?: string | null };

export default function NovoTituloManual({
  clientId, kind, aoFechar, aoCriar,
}: {
  clientId: string;
  kind: "payable" | "receivable";
  aoFechar: () => void;
  aoCriar: () => void | Promise<void>;
}) {
  const { t } = useT();
  const hoje = new Date().toISOString().slice(0, 10);
  const [contas, setContas] = useState<Conta[]>([]);
  const [contraparte, setContraparte] = useState("");
  const [ref, setRef] = useState("");
  const [emissao, setEmissao] = useState(hoje);
  const [vencimento, setVencimento] = useState(hoje);
  const [valor, setValor] = useState("");
  const [conta, setConta] = useState("");
  const [notas, setNotas] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  const aPagar = kind === "payable";

  useEffect(() => {
    /*
     * O plano COMPARTILHADO, e não o do cliente.
     *
     * É dele que o motor contábil se serve — é onde estão 6900, 4900 e as
     * rubricas do balanço. Oferecer aqui o plano próprio do cliente daria uma
     * lista quase vazia e uma conta que o gatilho do banco recusaria.
     */
    fetch(`/api/clients/${clientId}/accounts`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const todas: Conta[] = j?.ledgerAccounts ?? [];
        // A pagar mostra DESPESA; a receber mostra RECEITA. Uma lista com as
        // 41 contas obriga a saber o plano de cor para lançar uma taxa.
        const querida = aPagar ? "expense" : "revenue";
        const filtradas = todas.filter((c) => c.type === querida);
        setContas(filtradas.length ? filtradas : todas);
      })
      .catch(() => setContas([]));
  }, [clientId, aPagar]);

  async function gravar() {
    setErro(null);
    setGravando(true);
    try {
      const r = await fetch(`/api/clients/${clientId}/titles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind, counterparty: contraparte, document_ref: ref,
          issue_date: emissao, due_date: vencimento,
          amount: Number(String(valor).replace(",", ".")),
          result_account: conta, notes: notas,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || t("manual.notSaved")); return; }
      await aoCriar();
    } finally {
      setGravando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/35 p-6" onClick={aoFechar}>
      <div className="mt-10 w-full max-w-lg rounded-xl2 bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">
              {aPagar ? t("manual.newPayable") : t("manual.newReceivable")}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t("manual.subtitle")}
            </p>
          </div>
          <button className="btn-ghost h-8 px-3 text-xs" onClick={aoFechar}>{t("common.close")}</button>
        </div>

        {erro && <p className="mt-3 text-sm text-danger">{erro}</p>}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col leading-tight sm:col-span-2">
            <span className="label">{aPagar ? "A quem se deve" : "Quem deve"} *</span>
            <input className="input w-full text-[13px]" value={contraparte}
              onChange={(e) => setContraparte(e.target.value)}
              placeholder={aPagar ? t("manual.counterpartyPayable") : t("manual.counterparty")} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">Documento</span>
            {/* Opcional: quem não tem número fica com o S/N gerado, como as
                notas sem número — ver `refDoDocumento`. */}
            <input className="input w-full text-[13px]" value={ref}
              onChange={(e) => setRef(e.target.value)} placeholder="opcional" />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">{t("manual.amount")}</span>
            <input className="input w-full text-right font-mono text-[13px]" value={valor}
              onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">Emissão</span>
            <input type="date" className="input w-full text-[13px]" value={emissao}
              onChange={(e) => setEmissao(e.target.value)} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">Vencimento</span>
            <input type="date" className="input w-full text-[13px]" value={vencimento}
              onChange={(e) => setVencimento(e.target.value)} />
          </label>
          <label className="flex flex-col leading-tight sm:col-span-2">
            <span className="label">{aPagar ? t("manual.expenseAcct") : t("manual.incomeAcct")} *</span>
            <select className="input w-full text-[13px]" value={conta}
              onChange={(e) => setConta(e.target.value)}>
              <option value="">{t("manual.choose")}</option>
              {contas.map((c) => (
                <option key={c.code} value={c.code}>{c.code} · {c.description}</option>
              ))}
            </select>
            <span className="mt-1 text-xs text-muted">
              É contra esta conta que o valor entra no razão. A contrapartida é{" "}
              {aPagar ? "fornecedores" : "clientes"}, e a baixa depois consome-a.
            </span>
          </label>
          <label className="flex flex-col leading-tight sm:col-span-2">
            <span className="label">Observação</span>
            <input className="input w-full text-[13px]" value={notas}
              onChange={(e) => setNotas(e.target.value)} placeholder="opcional" />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button className="btn-ghost h-9 px-4 text-sm" onClick={aoFechar}>Cancelar</button>
          <button className="btn-primary h-9 px-4 text-sm" disabled={gravando} onClick={gravar}>
            {gravando ? t("common.saving") : "Lançar"}
          </button>
        </div>
      </div>
    </div>
  );
}
