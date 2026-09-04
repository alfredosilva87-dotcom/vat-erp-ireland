"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT, type TKey } from "@/lib/i18n";
import { currentIsoWeek } from "@/lib/hr/payroll";
import { waMostrar, waNumber } from "@/lib/whatsapp";

/**
 * O PAINEL DE CONVERSAS DA FOLHA.
 *
 * ---------------------------------------------------------------------------
 * O QUE ISTO É, E O QUE NÃO É
 *
 * Não é um cliente de WhatsApp, e não podia ser: a Cloud API da Meta só entrega
 * mensagens enviadas para um número registado na plataforma Business, e as
 * horas chegam ao telemóvel PESSOAL de quem faz a folha. Nenhum número pessoal
 * é legível por via oficial — prometer um motor que vasculha o WhatsApp seria
 * prometer o que não existe.
 *
 * O que existe, e faltava, é deixar de perder a mensagem. Hoje ela vive no
 * telemóvel de uma pessoa: não há registo de quem mandou o quê, nem de quando,
 * nem do que se leu. Aqui fica — com o texto original, a leitura ao lado, e o
 * que foi para a fila.
 *
 * ---------------------------------------------------------------------------
 * A ORDEM DA LISTA É A ORDEM DO TRABALHO
 *
 * Primeiro quem NÃO mandou nada esta semana. À sexta-feira, a pergunta é sempre
 * essa — e por nome alfabético ela não se responde.
 */

type Cliente = {
  id: string; client_code: string | null; name: string;
  phone: string | null; email: string | null;
  ultima: { direction: string; body: string; created_at: string } | null;
  recebidasNaSemana: number; pendentesNaFila: number;
};
type Mensagem = {
  id: string; direction: "in" | "out"; channel: string; body: string;
  year: number | null; week_no: number | null; queued: number;
  parsed: any; created_at: string;
};

export default function Conversas() {
  const { t } = useT();
  const [semana, setSemana] = useState(() => currentIsoWeek());
  const ano = new Date().getUTCFullYear();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [sentido, setSentido] = useState<"in" | "out">("in");
  const [previa, setPrevia] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [soEmFalta, setSoEmFalta] = useState(false);

  const carregarLista = useCallback(async () => {
    try {
      const r = await fetch(`/api/hr/conversations?year=${ano}&week=${semana}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErro(j.error); return; }
      setClientes(j.clientes ?? []);
    } catch { setErro(t("conv.falhou")); }
  }, [ano, semana, t]);

  const carregarConversa = useCallback(async (id: string) => {
    const r = await fetch(`/api/hr/conversations/${id}`, { cache: "no-store" });
    const j = await r.json();
    if (r.ok) setMensagens(j.mensagens ?? []);
  }, []);

  useEffect(() => { carregarLista(); }, [carregarLista]);
  useEffect(() => { if (escolhido) carregarConversa(escolhido); }, [escolhido, carregarConversa]);

  const cliente = useMemo(() => clientes.find((c) => c.id === escolhido) ?? null, [clientes, escolhido]);
  const emFalta = clientes.filter((c) => !c.recebidasNaSemana).length;
  const lista = soEmFalta ? clientes.filter((c) => !c.recebidasNaSemana) : clientes;

  async function ler() {
    if (!escolhido || !texto.trim()) return;
    setOcupado(true); setErro(null); setRecado(null);
    try {
      const r = await fetch(`/api/hr/conversations/${escolhido}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: texto, direction: sentido, year: ano, weekNo: semana }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || t("conv.falhou")); return; }
      setPrevia(j);
    } finally { setOcupado(false); }
  }

  async function gravar() {
    if (!escolhido || !texto.trim()) return;
    setOcupado(true); setErro(null);
    try {
      const r = await fetch(`/api/hr/conversations/${escolhido}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: texto, direction: sentido, year: ano, weekNo: semana, confirm: true,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || t("conv.falhou")); return; }
      setRecado(j.queued
        ? t("conv.gravadoComHoras", { n: String(j.queued), semCasar: String(j.semCasar ?? 0) })
        : t("conv.gravado"));
      setTexto(""); setPrevia(null);
      await carregarConversa(escolhido);
      await carregarLista();
    } finally { setOcupado(false); }
  }

  async function apagar(id: string) {
    if (!escolhido) return;
    if (!window.confirm(t("conv.confirmarApagar"))) return;
    await fetch(`/api/hr/conversations/${escolhido}?id=${id}`, { method: "DELETE" });
    await carregarConversa(escolhido);
    await carregarLista();
  }

  const quando = (s: string) => new Date(s).toLocaleString("en-IE", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{t("conv.titulo")}</h1>
          <p className="mt-1 max-w-3xl text-muted">{t("conv.ajuda")}</p>
        </div>
        <label className="flex flex-col leading-tight">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">
            {t("hr.weekShort")}
          </span>
          <input className="input h-9 w-24 text-[13px] font-semibold" type="number" min="1" max="53"
            value={semana} onChange={(e) => setSemana(Number(e.target.value))} />
        </label>
      </div>

      {/* O número que faz esta tela existir. */}
      <div className="card flex flex-wrap items-center gap-4 px-4 py-3 text-[13px]">
        <span className={emFalta ? "chip-danger" : "chip-ok"}>
          {t("conv.emFalta", { n: String(emFalta), semana: String(semana) })}
        </span>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" className="h-4 w-4 cursor-pointer" checked={soEmFalta}
            onChange={(e) => setSoEmFalta(e.target.checked)} />
          {t("conv.soEmFalta")}
        </label>
      </div>

      {erro && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* ------------------------------------------------ a lista */}
        <div className="card max-h-[70vh] overflow-y-auto">
          {lista.map((c) => (
            <button key={c.id} onClick={() => { setEscolhido(c.id); setPrevia(null); setRecado(null); }}
              className={`block w-full border-b border-line/60 px-4 py-3 text-left transition
                ${escolhido === c.id ? "bg-brand-50" : "hover:bg-surface-2"}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                {!c.recebidasNaSemana
                  ? <span className="chip-danger text-[10px]">{t("conv.semNoticias")}</span>
                  : <span className="chip-ok text-[10px]">{c.recebidasNaSemana}</span>}
              </div>
              <p className="mt-0.5 truncate text-[11.5px] text-muted">
                {c.ultima
                  ? `${c.ultima.direction === "in" ? "←" : "→"} ${c.ultima.body}`
                  : t("conv.semHistorico")}
              </p>
              {!!c.pendentesNaFila && (
                <p className="mt-0.5 text-[11px] text-warning">
                  {t("conv.pendentes", { n: String(c.pendentesNaFila) })}
                </p>
              )}
            </button>
          ))}
          {!lista.length && <p className="px-4 py-10 text-center text-muted">{t("conv.nenhum")}</p>}
        </div>

        {/* ------------------------------------------------ a conversa */}
        <div className="card flex min-h-[50vh] flex-col">
          {!cliente ? (
            <p className="m-auto text-muted">{t("conv.escolha")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div>
                  <p className="font-display text-[15px] font-semibold">{cliente.name}</p>
                  <p className="text-[11.5px] text-muted">
                    {waMostrar(cliente.phone) || t("conv.semTelefone")}
                  </p>
                </div>
                {/*
                  O envio continua a ser o link `wa.me`: abre a conversa no
                  aparelho de quem trabalha, e é uma pessoa que carrega em
                  enviar. Mandar por nós exigiria um número Business, que não
                  é o número por onde estas mensagens chegam.
                */}
                {waNumber(cliente.phone) && (
                  <a className="btn-ghost h-9 px-4 text-sm" target="_blank" rel="noopener noreferrer"
                    href={`https://wa.me/${waNumber(cliente.phone)}?text=${encodeURIComponent(t("conv.pedido", { semana: String(semana) }))}`}>
                    {t("conv.abrirWhatsApp")}
                  </a>
                )}
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
                {mensagens.map((m) => (
                  <div key={m.id}
                    className={`max-w-[80%] rounded-xl border px-3 py-2 text-[13px] ${
                      m.direction === "in"
                        ? "border-line bg-surface-2"
                        : "ml-auto border-brand-200 bg-brand-50"}`}>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-muted">
                      <span>{quando(m.created_at)}</span>
                      {m.week_no && <span>· {t("hr.weekShort")}{m.week_no}</span>}
                      {!!m.queued && <span className="text-ok">· {t("conv.foiParaFila", { n: String(m.queued) })}</span>}
                      {!!m.parsed?.naoLidas?.length && (
                        <span className="text-warning">
                          · {t("conv.porLer", { n: String(m.parsed.naoLidas.length) })}
                        </span>
                      )}
                      <button className="underline" onClick={() => apagar(m.id)}>{t("common.delete")}</button>
                    </p>
                  </div>
                ))}
                {!mensagens.length && (
                  <p className="py-10 text-center text-muted">{t("conv.semHistorico")}</p>
                )}
              </div>

              {/* ------------------------------------------ escrever */}
              <div className="border-t border-line px-4 py-3">
                <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input type="radio" checked={sentido === "in"} onChange={() => { setSentido("in"); setPrevia(null); }} />
                    {t("conv.recebida")}
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input type="radio" checked={sentido === "out"} onChange={() => { setSentido("out"); setPrevia(null); }} />
                    {t("conv.enviada")}
                  </label>
                </div>
                <textarea className="input mt-2 min-h-[90px] w-full py-2 font-mono text-[12.5px]"
                  placeholder={t("conv.colar")} value={texto}
                  onChange={(e) => { setTexto(e.target.value); setPrevia(null); }} />

                {/* A PRÉ-VISUALIZAÇÃO: o que se entendeu, ao lado do original. */}
                {previa?.leitura?.linhas?.length > 0 && (
                  <table className="mt-2 w-full text-[12.5px]">
                    <thead>
                      <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                        <th className="py-1 pr-3 font-medium">{t("wa.colNome")}</th>
                        <th className="py-1 pr-3 text-right font-medium">{t("wa.colTotal")}</th>
                        <th className="py-1 pr-3 text-right font-medium">{t("wa.colNormais")}</th>
                        <th className="py-1 pr-3 text-right font-medium">{t("wa.colDomingo")}</th>
                        <th className="py-1 pr-3 text-right font-medium">{t("wa.colFeriado")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previa.leitura.linhas.map((l: any, i: number) => (
                        <tr key={i} className="border-b border-line/50">
                          <td className="py-1 pr-3">{l.nome}</td>
                          <td className="py-1 pr-3 text-right tnum text-muted">{l.horas ?? "—"}</td>
                          <td className="py-1 pr-3 text-right tnum">{l.horasNormais ?? "—"}</td>
                          <td className="py-1 pr-3 text-right tnum">{l.horasDomingo ?? "—"}</td>
                          <td className="py-1 pr-3 text-right tnum">{l.horasFeriado ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {!!previa?.leitura?.naoLidas?.length && (
                  <div className="mt-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px]">
                    <p>{t("wa.naoLidas", { n: String(previa.leitura.naoLidas.length) })}</p>
                    <ul className="mt-1 font-mono text-[11.5px] text-muted">
                      {previa.leitura.naoLidas.map((l: string, i: number) => <li key={i}>{l}</li>)}
                    </ul>
                  </div>
                )}
                {recado && (
                  <p className="mt-2 rounded-lg border border-ok/40 bg-success-50 px-3 py-2 text-[12.5px]">{recado}</p>
                )}

                <div className="mt-2 flex flex-wrap gap-3">
                  {sentido === "in" && (
                    <button className="btn-ghost h-9 px-4 text-sm" disabled={ocupado || !texto.trim()} onClick={ler}>
                      {t("conv.ler")}
                    </button>
                  )}
                  <button className="btn-primary h-9 px-4 text-sm" disabled={ocupado || !texto.trim()} onClick={gravar}>
                    {ocupado ? "…" : t("conv.guardar")}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
