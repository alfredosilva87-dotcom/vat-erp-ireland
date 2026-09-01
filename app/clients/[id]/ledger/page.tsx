"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AccountPicker from "@/components/accounting/AccountPicker";
import { getExercise } from "@/lib/exercise";
import { useT } from "@/lib/i18n";

/**
 * O RAZÃO — a tela de conciliação.
 *
 * As telas de Contabilidade (balancete, DRE, balanço) são de FECHO: olham um
 * exercício inteiro e respondem "quanto". Esta é de CONCILIAÇÃO e responde
 * "de onde": abre-se uma conta, escolhe-se a janela de datas do extrato que
 * chegou, e corre-se o olho pelas linhas até o saldo deixar de bater.
 *
 * Por isso o recorte aqui é POR DATA e não por ano, e por isso se escolhe
 * quais contas entram — no ecrã e no ficheiro, com uma escolha só.
 */

type Lancamento = {
  id: string; date: string; entryDate: string; sourceModule: string;
  documentId: string | null; documentRef: string | null; journalId: string;
  counterparty: string | null; description: string | null; resolvedBy: string | null;
  debit: number; credit: number; balance: number;
};
type Conta = {
  code: string; name: string; type: string | null; side: "debit" | "credit";
  opening: number; debit: number; credit: number; closing: number;
  entries: Lancamento[];
};
type Razao = {
  from: string; to: string;
  accounts: Conta[];
  available: { code: string; name: string; entries: number; movement: number }[];
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;

export default function LedgerPage({ params }: { params: { id: string } }) {
  const { t } = useT();
  const [ano] = useState(() => getExercise());
  const [de, setDe] = useState(() => `${getExercise()}-01-01`);
  const [ate, setAte] = useState(() => `${getExercise()}-12-31`);
  const [selecionadas, setSelecionadas] = useState<string[] | null>(null);
  /*
   * O RECORTE POR DOCUMENTO — "ver no razão" a partir de uma nota.
   *
   * Pedido do Alfredo em 2026-09-01: "na opção na nota `ver no razão` deveria
   * abrir apenas os lançamentos da nota". Abria o razão inteiro do exercício e
   * deixava a pessoa a procurar a própria nota numa lista de centenas.
   *
   * Lido de `window.location` e não com `useSearchParams()` de propósito: o
   * hook obriga a fronteira de Suspense e o build quebra sem ela, e isto é uma
   * leitura só, uma vez, numa tela que já é de cliente.
   */
  const [doc, setDoc] = useState<string | null>(null);
  const [lanc, setLanc] = useState<string | null>(null);
  const [d, setD] = useState<Razao | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  /*
   * Carrega o razão INTEIRO do período e filtra no navegador.
   *
   * A seleção de contas não vai na consulta de propósito: marcar e desmarcar
   * uma caixa passaria a esperar pelo servidor, e a leitura das contas é a
   * parte cara. O filtro só volta ao servidor na hora de gerar o ficheiro,
   * onde tem de ser o servidor a montar o documento.
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/clients/${params.id}/accounting/ledger?from=${de}&to=${ate}`,
        { cache: "no-store" }
      );
      const res = await r.json();
      if (!r.ok) throw new Error(res.error || "Falhou.");
      setD(res);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
      setD(null);
    } finally {
      setLoading(false);
    }
  }, [params.id, de, ate]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const d = p.get("doc") || null;
    const l = p.get("lanc") || null;
    setDoc(d); setLanc(l);
    /*
     * A JANELA alarga quando se vem de um documento.
     *
     * O padrão é o exercício escolhido, e uma nota de dezembro do ano passado
     * cairia fora dele: o recorte encontrava zero e a tela dizia "sem
     * movimento", que se lê como "não foi contabilizada" — a conclusão errada,
     * e a mais cara de todas as erradas.
     */
    if (d || l) {
      const y = getExercise();
      setDe(`${y - 2}-01-01`);
      setAte(`${y + 1}-12-31`);
    }
  }, []);

  const mostradas = useMemo(() => {
    if (!d) return [];
    const porConta = selecionadas === null
      ? d.accounts
      : d.accounts.filter((c) => selecionadas.includes(c.code));
    if (!doc && !lanc) return porConta;
    /*
     * Recortado, só ficam as contas que o documento TOCA.
     *
     * Mostrar as outras vazias faria a resposta a "onde é que esta nota entrou
     * no razão" ser uma lista de contas onde ela não entrou.
     */
    return porConta
      .map((c) => ({
        ...c,
        entries: c.entries.filter((l) =>
          (doc && l.documentId === doc) || (lanc && l.journalId === lanc)),
      }))
      .filter((c) => c.entries.length > 0);
  }, [d, selecionadas, doc, lanc]);

  /*
   * Recortado, os totais são os das LINHAS mostradas.
   *
   * Os da conta inteira, ao lado de quatro linhas, leem-se como sendo delas —
   * e um total que não é a soma do que está por cima é a pior espécie de número
   * errado, porque parece conferido.
   */
  const recortado = !!(doc || lanc);

  const totais = useMemo(() => (recortado
    ? {
      debit: r2(mostradas.reduce((s, c) => s + c.entries.reduce((x, l) => x + l.debit, 0), 0)),
      credit: r2(mostradas.reduce((s, c) => s + c.entries.reduce((x, l) => x + l.credit, 0), 0)),
      closing: 0,
    }
    : {
      debit: r2(mostradas.reduce((s, c) => s + c.debit, 0)),
      credit: r2(mostradas.reduce((s, c) => s + c.credit, 0)),
      closing: r2(mostradas.reduce((s, c) => s + c.closing, 0)),
    }), [mostradas, recortado]);

  function periodo(preset: "month" | "prev" | "quarter" | "year") {
    const hoje = new Date();
    // O ano do EXERCÍCIO, e não o de hoje: quem está a conciliar 2025 em
    // março de 2026 espera que "Este mês" caia no exercício que escolheu.
    const y = ano;
    const m = hoje.getFullYear() === y ? hoje.getMonth() : 11;
    const fim = (a: number, mes: number) => new Date(Date.UTC(a, mes + 1, 0));
    if (preset === "year") { setDe(`${y}-01-01`); setAte(`${y}-12-31`); return; }
    if (preset === "quarter") {
      const q = Math.floor(m / 3) * 3;
      setDe(iso(new Date(Date.UTC(y, q, 1)))); setAte(iso(fim(y, q + 2))); return;
    }
    const alvo = preset === "prev" ? m - 1 : m;
    const base = new Date(Date.UTC(y, alvo, 1));
    setDe(iso(base)); setAte(iso(fim(base.getUTCFullYear(), base.getUTCMonth())));
  }

  const eur = (v: number) =>
    v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // O que a tela mostra é o que o ficheiro leva: mesma janela, mesmas contas.
  const query = `from=${de}&to=${ate}`
    + (selecionadas === null ? "" : `&accounts=${selecionadas.join(",")}`);
  const podeExportar = mostradas.length > 0;

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{t("ledger.title")}</h1>
          <p className="mt-1 text-muted">{t("ledger.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col leading-tight">
            <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">{t("ledger.from")}</span>
            <input type="date" className="input h-9 w-auto py-0 text-[13px] font-semibold"
              value={de} onChange={(e) => setDe(e.target.value)} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">{t("ledger.to")}</span>
            <input type="date" className="input h-9 w-auto py-0 text-[13px] font-semibold"
              value={ate} onChange={(e) => setAte(e.target.value)} />
          </label>
          <a className={`btn-ghost ${podeExportar ? "" : "pointer-events-none opacity-40"}`}
            href={`/api/clients/${params.id}/accounting/ledger.pdf?${query}`}>PDF</a>
          <a className={`btn-primary ${podeExportar ? "" : "pointer-events-none opacity-40"}`}
            href={`/api/clients/${params.id}/accounting/ledger.xlsx?${query}`}>Excel</a>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {([["month", "ledger.presetMonth"], ["prev", "ledger.presetPrevMonth"],
           ["quarter", "ledger.presetQuarter"], ["year", "ledger.presetYear"]] as const).map(([k, key]) => (
          <button key={k} className="btn-ghost h-8 px-3 text-xs" onClick={() => periodo(k)}>
            {t(key)}
          </button>
        ))}
      </div>

      {erro && <p className="text-sm text-danger">{erro}</p>}

      {/*
        * A FAIXA do recorte.
        *
        * Uma tela filtrada que não diz que está filtrada é a origem de metade
        * dos "sumiu tudo": a pessoa lê quatro linhas onde havia quatrocentas e
        * conclui coisa errada sobre o razão, não sobre o filtro.
        */}
      {recortado && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-brand p-4">
          <p className="text-sm">
            <span className="chip mr-2 text-[11px]">{t("ledger.filteredChip")}</span>
            {t("ledger.filteredHelp")}
            {mostradas.length === 0 && (
              <span className="ml-2 text-danger">{t("ledger.filteredEmpty")}</span>
            )}
          </p>
          <button
            className="btn-ghost h-8 px-3 text-xs"
            onClick={() => {
              setDoc(null); setLanc(null);
              // A URL acompanha, senão recarregar a página traz o filtro de volta
              // e a pessoa carrega no mesmo botão outra vez.
              window.history.replaceState(null, "", window.location.pathname);
            }}
          >
            {t("ledger.filteredClear")}
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)]">
          <AccountPicker
            available={d?.available ?? []}
            selected={selecionadas}
            onChange={setSelecionadas}
          />
        </div>

        <div className="space-y-4">
          {loading && <div className="card p-10 text-center text-muted">{t("common.loading")}</div>}

          {!loading && d && mostradas.length === 0 && (
            <div className="card p-10 text-center text-muted">
              {d.available.length === 0 ? t("ledger.empty") : t("ledger.pickSome")}
            </div>
          )}

          {!loading && mostradas.map((conta) => (
            <ContaCard key={conta.code} conta={conta} eur={eur} t={t} recortado={recortado} />
          ))}

          {!loading && mostradas.length > 0 && (
            <>
              <div className="card flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-brand p-4">
                <span className="text-sm font-semibold">{t("ledger.totalSelected")}</span>
                <span className="flex gap-6 font-mono text-sm tabular-nums">
                  <span>{t("ledger.colDebit")} <b>{eur(totais.debit)}</b></span>
                  <span>{t("ledger.colCredit")} <b>{eur(totais.credit)}</b></span>
                  <span>{t("ledger.colBalance")} <b>{eur(totais.closing)}</b></span>
                </span>
              </div>
              {/*
                Débito e crédito de uma seleção parcial não fecham entre si, e
                não devem. Sem este aviso, quem abre três contas e vê os totais
                diferentes conclui que o razão está torto — e vai procurar um
                erro que não existe.
              */}
              <p className="px-1 text-xs text-muted">{t("ledger.partialWarning")}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Uma conta: saldo anterior, lançamentos com saldo corrido, e o fecho. */
/*
 * Recortado, a coluna do SALDO sai.
 *
 * O saldo corrido é a soma de tudo o que veio antes na conta. Mostrado ao lado
 * de quatro linhas escolhidas a dedo, continua a dizer o número da conta
 * inteira e lê-se como se fosse o das quatro — um número certo no sítio onde
 * significa outra coisa, que é pior do que não estar lá.
 */
function ContaCard({ conta, eur, t, recortado }: {
  conta: Conta; eur: (v: number) => string; t: any; recortado?: boolean;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 bg-surface-2/70 px-4 py-2.5">
        <span className="font-display text-sm font-semibold">
          <span className="font-mono text-xs text-muted">{conta.code}</span>{"  "}{conta.name}
        </span>
        <span className="chip bg-surface-2 text-[11px] text-muted">
          {conta.side === "debit" ? t("ledger.colDebit") : t("ledger.colCredit")}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="row-hover w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
              <th className="px-3 py-1.5 text-left font-medium">{t("ledger.colDate")}</th>
              <th className="px-3 py-1.5 text-left font-medium">{t("ledger.colDoc")}</th>
              <th className="px-3 py-1.5 text-left font-medium">{t("ledger.colHistory")}</th>
              <th className="px-3 py-1.5 text-right font-medium">{t("ledger.colDebit")}</th>
              <th className="px-3 py-1.5 text-right font-medium">{t("ledger.colCredit")}</th>
              {!recortado && <th className="px-3 py-1.5 text-right font-medium">{t("ledger.colBalance")}</th>}
            </tr>
          </thead>
          <tbody>
            {!recortado && (
              <tr className="border-b border-line/70 bg-brand-50/60 font-semibold">
                <td className="px-3 py-1.5" colSpan={5}>{t("ledger.opening")}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{eur(conta.opening)}</td>
              </tr>
            )}

            {conta.entries.map((l) => (
              <tr key={l.id} className="border-b border-line/50">
                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11.5px] text-muted">{l.date}</td>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11.5px]">
                  {l.documentRef || <span className="text-muted">{l.sourceModule}</span>}
                </td>
                <td className="px-3 py-1.5">{l.counterparty || l.description || "—"}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{l.debit ? eur(l.debit) : ""}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{l.credit ? eur(l.credit) : ""}</td>
                {!recortado && <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted">{eur(l.balance)}</td>}
              </tr>
            ))}

            {conta.entries.length === 0 && (
              <tr><td colSpan={recortado ? 5 : 6} className="px-3 py-6 text-center text-muted">{t("ledger.noMovement")}</td></tr>
            )}

            <tr className="bg-surface-2/70 font-semibold">
              <td className="px-3 py-2" colSpan={3}>
                {recortado ? t("ledger.filteredSubtotal") : t("ledger.closing")}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {eur(recortado ? conta.entries.reduce((s, l) => s + l.debit, 0) : conta.debit)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {eur(recortado ? conta.entries.reduce((s, l) => s + l.credit, 0) : conta.credit)}
              </td>
              {!recortado && (
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(conta.closing)}</td>
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
