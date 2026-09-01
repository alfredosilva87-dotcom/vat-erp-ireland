"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

/**
 * A LIMPEZA DO RAZÃO.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA TELA EXISTE PARA ACABAR
 *
 * Conta 812: razão 4.924,01, títulos 4.958,21, diferença −34,20 — e nenhum
 * caminho no ecrã que levasse à causa nem à correcção. A causa eram três
 * partidas cujas linhas de origem tinham sido levadas pela cascata do banco de
 * dados ao apagar o título; a correcção só existia por SQL à mão, que é
 * precisamente o caminho que ninguém audita.
 *
 * ---------------------------------------------------------------------------
 * DUAS OPERAÇÕES, E A DIFERENÇA ENTRE ELAS É O DESENHO DA TELA
 *
 * **Estornar** — a partida original fica e nasce a espelhada. Nada desaparece.
 * É o que se faz a um facto que existiu e ficou errado, e o único caminho num
 * período fechado.
 *
 * **Apagar** — o lançamento sai. É o que se faz ao lixo: partida cuja origem
 * já não existe e que nunca devia ter ficado. Estornar lixo com lixo duplica
 * as linhas que alguém vai ter de explicar em vez de as reduzir.
 *
 * Nos dois casos fica o registo com o lançamento inteiro. Foi assim que se
 * conciliou "excluir" com "não perder o rastro", que foram pedidos na mesma
 * frase: apagar deixa de ser um buraco e passa a ser uma decisão registada.
 *
 * ---------------------------------------------------------------------------
 * A TELA ABRE COM O LIXO, E NÃO COM O RAZÃO
 *
 * Uma tela destrutiva que abre a listar tudo convida ao clique distraído. Esta
 * abre com o que a detecção encontrou sozinha; o resto procura-se.
 */

type Conta = { code: string; debit: number; credit: number };
type Orfa = {
  journalId: string; postingDate: string; sourceModule: string;
  documentRef: string | null; falta: string; contas: Conta[];
};
type Encontrada = {
  journalId: string; postingDate: string; sourceModule: string;
  documentId: string | null; documentRef: string | null; description: string | null;
  ehEstorno: boolean; orfa: boolean; contas: Conta[];
};
type Removida = {
  id: string; journalId: string; action: "reverse" | "delete"; reason: string;
  note: string | null; removedAt: string; reversalJournalId: string | null;
  postingDate: string | null; documentRef: string | null; description: string | null; total: number;
};
type Dados = { orfas: Orfa[]; procuradas: Encontrada[]; buscou: boolean; historico: Removida[] };

const eur = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(n || 0);

/** O total de uma partida é o lado do débito — os dois lados são iguais. */
const valor = (contas: Conta[]) => contas.reduce((s, c) => s + (c.debit || 0), 0);

export default function CleanupPage({ params }: { params: { id: string } }) {
  const { t } = useT();
  const [d, setD] = useState<Dados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [conta, setConta] = useState("");
  const [termo, setTermo] = useState("");
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`/api/clients/${params.id}/accounting/cleanup${busca}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falhou.");
      setD(j);
      setErro(null);
    } catch (e: any) {
      setErro(e.message); setD(null);
    } finally {
      setCarregando(false);
    }
  }, [params.id, busca]);

  useEffect(() => { carregar(); }, [carregar]);

  function alternar(id: string) {
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function remover(acao: "reverse" | "delete") {
    const n = marcados.size;
    if (!n) return;
    const msg = acao === "reverse"
      ? t("cleanup.confirmReverse", { n }) : t("cleanup.confirmDelete", { n });
    if (!confirm(msg)) return;

    setOcupado(true); setErro(null); setAviso(null);
    try {
      const r = await fetch(`/api/clients/${params.id}/accounting/cleanup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          journalIds: [...marcados], action: acao, note: nota,
          // O motivo distingue o que a detecção achou do que alguém escolheu —
          // é o que permite ler o histórico depois e saber de que tipo de
          // problema se tratava.
          reason: [...marcados].every((id) => d?.orfas.some((o) => o.journalId === id)) ? "orphan" : "manual",
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falhou."); return; }
      setAviso(t("cleanup.done", { n: j.removidos, f: j.falhas.length }));
      // As falhas vêm com o motivo de cada uma: um lote em que o terceiro está
      // num período fechado não pode dizer só "falhou".
      if (j.falhas.length) {
        setErro(j.falhas.map((f: any) => `${f.journalId.slice(0, 8)}: ${f.erro}`).join(" · "));
      }
      setMarcados(new Set()); setNota("");
      await carregar();
    } finally { setOcupado(false); }
  }

  function procurar(e: React.FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams();
    if (de) p.set("from", de);
    if (ate) p.set("to", ate);
    if (conta.trim()) p.set("account", conta.trim());
    if (termo.trim()) p.set("q", termo.trim());
    setBusca(p.toString() ? `?${p}` : "");
  }

  const linhasContas = (cs: Conta[]) =>
    cs.map((c) => `${c.code} ${c.debit ? "D" : "C"} ${eur(c.debit || c.credit)}`).join(" · ");

  return (
    <div className="space-y-4">
      <div className="rise">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{t("cleanup.title")}</h1>
        <p className="mt-1 text-muted">{t("cleanup.subtitle")}</p>
      </div>

      {erro && (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>
      )}
      {aviso && (
        <p className="rounded-lg border border-ok/40 bg-success-50 px-3 py-2 text-sm">{aviso}</p>
      )}

      {/* ---------------------------------------------- o lixo detectado */}
      <section className={`card border-l-4 p-5 ${d?.orfas.length ? "border-l-danger" : "border-l-ok"}`}>
        <h2 className="font-display text-base font-semibold">{t("cleanup.orphansTitle")}</h2>
        <p className="mt-1 max-w-3xl text-[12.5px] text-muted">{t("cleanup.orphansHelp")}</p>

        {carregando && <p className="mt-3 text-sm text-muted">…</p>}

        {!carregando && !d?.orfas.length && (
          <p className="mt-3 text-sm">{t("cleanup.orphansNone")}</p>
        )}

        {!!d?.orfas.length && (
          <div className="-mx-1 mt-3 overflow-x-auto px-1">
            <table className="row-hover w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                  <th className="w-8 py-2" />
                  <th className="py-2 text-left">{t("cleanup.colDate")}</th>
                  <th className="py-2 text-left">{t("cleanup.colDoc")}</th>
                  <th className="py-2 text-left">{t("cleanup.colMissing")}</th>
                  <th className="py-2 text-left">{t("cleanup.colEntry")}</th>
                  <th className="py-2 text-right">{t("cleanup.colAmount")}</th>
                </tr>
              </thead>
              <tbody>
                {d.orfas.map((o) => (
                  <tr key={o.journalId} className="border-b border-line/60">
                    <td className="py-2">
                      <input type="checkbox" checked={marcados.has(o.journalId)}
                        onChange={() => alternar(o.journalId)} aria-label={o.journalId} />
                    </td>
                    <td className="tnum py-2 whitespace-nowrap">{o.postingDate}</td>
                    <td className="py-2 font-mono text-[12px]">{o.documentRef || "—"}</td>
                    <td className="py-2 text-muted">{o.falta}</td>
                    <td className="py-2 font-mono text-[11.5px] text-muted">{linhasContas(o.contas)}</td>
                    <td className="tnum py-2 text-right font-semibold">{eur(valor(o.contas))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- a busca */}
      <section className="card p-5">
        <h2 className="font-display text-base font-semibold">{t("cleanup.searchTitle")}</h2>
        <p className="mt-1 max-w-3xl text-[12.5px] text-muted">{t("cleanup.searchHelp")}</p>

        <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={procurar}>
          <label className="flex flex-col leading-tight">
            <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">{t("cleanup.from")}</span>
            <input type="date" className="input h-9 w-auto py-0 text-[13px]" value={de} onChange={(e) => setDe(e.target.value)} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">{t("cleanup.to")}</span>
            <input type="date" className="input h-9 w-auto py-0 text-[13px]" value={ate} onChange={(e) => setAte(e.target.value)} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">{t("cleanup.account")}</span>
            <input className="input h-9 w-24 py-0 text-[13px]" value={conta} onChange={(e) => setConta(e.target.value)} placeholder="812" />
          </label>
          <label className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">{t("cleanup.term")}</span>
            <input className="input h-9 w-full py-0 text-[13px]" value={termo} onChange={(e) => setTermo(e.target.value)} />
          </label>
          <button className="btn-ghost h-9 px-4 text-sm" type="submit">{t("cleanup.search")}</button>
        </form>

        {!d?.buscou && <p className="mt-3 text-[12.5px] text-muted">{t("cleanup.searchPrompt")}</p>}
        {d?.buscou && !d.procuradas.length && <p className="mt-3 text-sm">{t("cleanup.noResults")}</p>}

        {!!d?.procuradas.length && (
          <div className="-mx-1 mt-3 overflow-x-auto px-1">
            <table className="row-hover w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                  <th className="w-8 py-2" />
                  <th className="py-2 text-left">{t("cleanup.colDate")}</th>
                  <th className="py-2 text-left">{t("cleanup.colDoc")}</th>
                  <th className="py-2 text-left">{t("cleanup.colDescription")}</th>
                  <th className="py-2 text-left">{t("cleanup.colEntry")}</th>
                  <th className="py-2 text-right">{t("cleanup.colAmount")}</th>
                </tr>
              </thead>
              <tbody>
                {d.procuradas.map((p) => (
                  <tr key={p.journalId} className="border-b border-line/60">
                    <td className="py-2">
                      <input type="checkbox" checked={marcados.has(p.journalId)}
                        onChange={() => alternar(p.journalId)} aria-label={p.journalId} />
                    </td>
                    <td className="tnum py-2 whitespace-nowrap">{p.postingDate}</td>
                    <td className="py-2 font-mono text-[12px]">
                      {p.documentRef || "—"}
                      {p.orfa && <span className="chip-danger ml-2 text-[10px]">{t("cleanup.orphan")}</span>}
                      {p.ehEstorno && <span className="chip ml-2 text-[10px]">{t("cleanup.isReversal")}</span>}
                    </td>
                    <td className="py-2 text-muted">{p.description || p.sourceModule}</td>
                    <td className="py-2 font-mono text-[11.5px] text-muted">{linhasContas(p.contas)}</td>
                    <td className="tnum py-2 text-right font-semibold">{eur(valor(p.contas))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/*
        * A BARRA DE AÇÃO só aparece com alguma coisa marcada.
        *
        * Dois botões sempre visíveis num ecrã que apaga movimento do razão
        * ensinam a mão a ir lá — e a nota obrigatória perde o sentido se estiver
        * sempre vazia à espera.
        */}
      {marcados.size > 0 && (
        <section className="card sticky bottom-3 z-20 border-l-4 border-l-brand p-5 shadow-lg">
          <p className="text-sm font-semibold">{t("cleanup.selected", { n: marcados.size })}</p>

          <label className="mt-3 block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{t("cleanup.note")}</span>
            <input className="input mt-1 w-full text-sm" value={nota} onChange={(e) => setNota(e.target.value)}
              placeholder={t("cleanup.notePlaceholder")} />
          </label>

          <div className="mt-3 flex flex-wrap gap-3">
            <div className="min-w-[240px] flex-1">
              <button className="btn-ghost h-10 w-full px-4 text-sm" disabled={ocupado}
                onClick={() => remover("reverse")}>
                {t("cleanup.reverse")}
              </button>
              <p className="mt-1 text-[11.5px] text-muted">{t("cleanup.reverseHelp")}</p>
            </div>
            <div className="min-w-[240px] flex-1">
              <button className="btn-ghost h-10 w-full px-4 text-sm text-danger" disabled={ocupado}
                onClick={() => remover("delete")}>
                {t("cleanup.delete")}
              </button>
              <p className="mt-1 text-[11.5px] text-muted">{t("cleanup.deleteHelp")}</p>
            </div>
          </div>
          <p className="mt-2 text-[11.5px] text-muted">{t("cleanup.adminOnly")}</p>
        </section>
      )}

      {/* ------------------------------------------------ o que já saiu */}
      <section className="card p-5">
        <h2 className="font-display text-base font-semibold">{t("cleanup.historyTitle")}</h2>
        {!d?.historico.length && <p className="mt-2 text-sm text-muted">{t("cleanup.historyNone")}</p>}
        {!!d?.historico.length && (
          <div className="-mx-1 mt-3 overflow-x-auto px-1">
            <table className="row-hover w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                  <th className="py-2 text-left">{t("cleanup.colWhen")}</th>
                  <th className="py-2 text-left">{t("cleanup.colAction")}</th>
                  <th className="py-2 text-left">{t("cleanup.colEntry")}</th>
                  <th className="py-2 text-left">{t("cleanup.colWhy")}</th>
                  <th className="py-2 text-right">{t("cleanup.colAmount")}</th>
                </tr>
              </thead>
              <tbody>
                {d.historico.map((h) => (
                  <tr key={h.id} className="border-b border-line/60">
                    <td className="tnum py-2 whitespace-nowrap">{new Date(h.removedAt).toLocaleString("pt-PT")}</td>
                    <td className="py-2">
                      <span className={h.action === "delete" ? "chip-danger text-[10px]" : "chip text-[10px]"}>
                        {h.action === "delete" ? t("cleanup.delete") : t("cleanup.reverse")}
                      </span>
                    </td>
                    <td className="py-2">
                      <span className="font-mono text-[12px]">{h.documentRef || h.journalId.slice(0, 8)}</span>
                      <span className="ml-2 text-muted">{h.postingDate} · {h.description || h.reason}</span>
                    </td>
                    <td className="py-2 text-muted">{h.note || "—"}</td>
                    <td className="tnum py-2 text-right">{eur(h.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11.5px] text-muted">
          <Link className="underline" href={`/clients/${params.id}/checkup`}>{t("checkup.title")}</Link>
          {" · "}
          <Link className="underline" href={`/clients/${params.id}/ledger`}>{t("cleanup.seeInLedger")}</Link>
        </p>
      </section>
    </div>
  );
}
