"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useT, type TKey } from "@/lib/i18n";
import { currentIsoWeek } from "@/lib/hr/payroll";

/** O servidor manda chave + parametros; a traducao acontece aqui. */
type Aviso = { codigo: string; params?: Record<string, string | number> };

/**
 * CORRER A FOLHA — bruto, imposto, líquido, e o que a pessoa custa.
 *
 * ---------------------------------------------------------------------------
 * PRÉ-VISUALIZAR E FECHAR SÃO COISAS DIFERENTES
 *
 * A pré-visualização calcula e não grava: pode correr as vezes que forem
 * precisas, e é o que se olha para conferir. Fechar é o acto que faz aqueles
 * números virarem o acumulado de que o período seguinte parte — e a partir daí
 * não se alteram, só se reabrem.
 *
 * Se abrir a tela contasse para o acumulado, abrir duas vezes somava duas
 * vezes, e a folha seguinte vinha errada sem nada a apontar a causa.
 *
 * ---------------------------------------------------------------------------
 * OS AVISOS FICAM AO LADO DA LINHA, E NÃO NUM RESUMO
 *
 * "3 avisos" no topo obriga a descobrir de quem são. Ao lado do nome, quem
 * confere vê logo que é o João que está sem PPS e a Maria em base de
 * emergência — que são coisas para tratar antes de fechar, não depois.
 */

type Parcela = { chave: string; horas: number; taxaCents: number; valorCents: number };
type Memoria = {
  semana: number; totalCents: number; parcelas: Parcela[];
  avisos: string[]; origemDomingo: string;
};

type Linha = {
  employeeId: string; nome: string; jobTitle: string | null;
  brutoCents: number; memoria?: Memoria[]; payeCents: number; uscCents: number;
  prsiEeCents: number; prsiErCents: number; liquidoCents: number;
  custoEmpregadorCents: number; aeEeCents: number; aeErCents: number;
  acumulado: { bruto: number; paye: number; usc: number; prsi: number };
  aplicado: { cutOff: number; creditos: number; base: string };
  avisos: Aviso[]; devolucaoSeguraCents: number; status: "draft" | "final" | null;
};
type Folha = {
  year: number; periodNo: number; freqType: string; payDate: string;
  linhas: Linha[];
  totais: { bruto: number; paye: number; usc: number; prsiEe: number; prsiEr: number; aeEe: number; aeEr: number; liquido: number; custoEmpregador: number };
  avisos: Aviso[];
};

const eur = (c: number) =>
  (c / 100).toLocaleString("en-IE", { style: "currency", currency: "EUR" });

export default function PayrollRun({
  clientId, year, freqType, mostrarHoras = true, aoMudarConfig,
}: {
  clientId: string; year: number; freqType: "weekly" | "fortnightly" | "monthly";
  /** `hr_client.payslip_show_hours` — vale para a empresa inteira. */
  mostrarHoras?: boolean;
  aoMudarConfig?: () => void;
}) {
  const { t } = useT();
  const maxPeriodo = freqType === "weekly" ? 53 : freqType === "fortnightly" ? 27 : 12;
  /*
   * Abre no periodo de AGORA, e nao no 1.
   *
   * Quem abre esta tela em Setembro quer a folha de Setembro. A abrir na semana
   * 1 via toda a gente a zero — sem horas lancadas, sem imposto — e a primeira
   * leitura era "isto nao funciona", quando o que faltava era mudar o seletor.
   */
  const [periodo, setPeriodo] = useState(() => {
    const semana = currentIsoWeek();
    if (freqType === "weekly") return Math.min(semana, maxPeriodo);
    if (freqType === "fortnightly") return Math.min(Math.ceil(semana / 2), maxPeriodo);
    return new Date().getMonth() + 1;
  });
  const [d, setD] = useState<Folha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [horas, setHoras] = useState(mostrarHoras);
  /*
   * A MEMÓRIA DE CÁLCULO abre por linha, e fechada por omissão.
   *
   * Aberta para toda a gente, a tabela da folha passava a ter cinco linhas por
   * pessoa e deixava de se ler de uma vez — que é o que esta tela serve para
   * fazer. Fechada, o detalhe está a um clique de quem tem uma dúvida sobre
   * UMA pessoa, que é como a dúvida aparece.
   */
  const [aberta, setAberta] = useState<string | null>(null);
  /*
   * VER O RECIBO AQUI, ou num separador — À ESCOLHA.
   *
   * O separador novo é o que funciona no telemóvel e é por isso que continua a
   * ser o normal. Mas quem confere trinta recibos ao computador passa a vida a
   * saltar entre separadores e a fechá-los, e perde de vista a tabela que está
   * a conferir. Embutido, o recibo aparece por baixo da linha de que ele é.
   *
   * Imposto seria pior do que não existir: um PDF de meio ecrã no telemóvel
   * empurra a tabela para fora da vista. Por isso é uma caixa, e nasce
   * desligada.
   */
  const [embutido, setEmbutido] = useState(false);
  const [pdf, setPdf] = useState<{ url: string; quem: string } | null>(null);

  /** O endereço do recibo. Sem `employee`, sai a empresa inteira. */
  const linkDoRecibo = (employeeId?: string) =>
    `/api/hr/companies/${clientId}/payslips?year=${year}&period=${periodo}&freq=${freqType}`
    + (employeeId ? `&employee=${employeeId}` : "");

  async function trocarHoras(valor: boolean) {
    // Optimista: a caixa mexe já, e volta atrás se o servidor recusar. Uma
    // caixa que fica presa até a rede responder parece partida.
    setHoras(valor);
    const r = await fetch(`/api/hr/companies/${clientId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payslip_show_hours: valor }),
    });
    if (!r.ok) { setHoras(!valor); setErro((await r.json()).error || "Falhou."); return; }
    aoMudarConfig?.();
  }

  const carregar = useCallback(async () => {
    setErro(null);
    const r = await fetch(
      `/api/hr/companies/${clientId}/payroll?year=${year}&period=${periodo}&freq=${freqType}`,
      { cache: "no-store" }
    );
    const j = await r.json();
    if (!r.ok) { setErro(j.error || "Falhou."); setD(null); return; }
    setD(j);
  }, [clientId, year, periodo, freqType]);

  useEffect(() => { carregar(); }, [carregar]);

  /*
   * SEGURAR uma devolucao.
   *
   * Quem sai da base de emergencia recebe de volta centenas de euros numa
   * semana, e esse dinheiro sai do bolso do empregador na hora. A decisao de
   * adiar e de quem paga; aqui so se respeita e se grava — com o motivo, que e
   * o que torna a decisao defensavel tres meses depois.
   */
  async function segurar(l: Linha, segurar: boolean) {
    let reason = "";
    if (segurar) {
      reason = window.prompt(t("run.holdWhy")) ?? "";
      if (!reason.trim()) return;
    }
    setOcupado(true); setErro(null);
    try {
      const r = await fetch(`/api/hr/companies/${clientId}/payroll`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year, period: periodo, freq: freqType,
          acao: segurar ? "segurar" : "soltar", employeeId: l.employeeId, reason,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falhou."); return; }
      await carregar();
    } finally { setOcupado(false); }
  }

  /*
   * O QUE ACONTECEU ÀS CONTAS A PAGAR, dito na mesma frase do fecho.
   *
   * Fechar a folha abre dois títulos — o líquido e o imposto. Fazê-lo em
   * silêncio deixava quem fecha sem saber que a dívida passou a existir, e a
   * descobri-la por acaso noutro ecrã. Pior: quando NÃO se abre (integração
   * desligada, ou o quadro semanal já ter criado), o silêncio parecia sucesso.
   *
   * O servidor manda CÓDIGO e não frase — ver `RecadoDoTitulo`. A tradução é
   * aqui, senão o ecrã inglês levava português.
   */
  function recadoDosTitulos(x: any): string {
    if (!x) return "";
    if (x.ignorado) return t(x.ignorado.codigo as TKey, x.ignorado.params);
    const nome = (tipo: string) => t(`titulo.${tipo}` as TKey);
    const feitos = (x.titulos ?? []).filter((u: any) => u.id);
    const fora = (x.titulos ?? []).filter((u: any) => !u.id && u.ignorado);
    const partes: string[] = [];
    if (feitos.length) {
      partes.push(t("run.titulosCriados", {
        quais: feitos.map((u: any) => `${nome(u.tipo)} ${eur(u.valorCents)}`).join(", "),
      }));
    }
    for (const u of fora) {
      partes.push(`${nome(u.tipo)}: ${t(u.ignorado.codigo as TKey, u.ignorado.params)}.`);
    }
    return partes.join(" ");
  }

  function recadoDaRemocao(x: any): string {
    if (!x) return "";
    const nome = (tipo: string) => t(`titulo.${tipo}` as TKey);
    const partes: string[] = [];
    if (x.removidos) partes.push(t("run.titulosRemovidos", { n: x.removidos }));
    if (x.mantidos?.length) {
      partes.push(t("run.titulosMantidos", {
        quais: x.mantidos
          .map((m: any) => `${nome(m.tipo)} (${t(m.motivo.codigo as TKey, m.motivo.params)})`)
          .join(", "),
      }));
    }
    return partes.join(" ");
  }

  /*
   * MANDAR O RECIBO à pessoa de quem ele é.
   *
   * Um de cada vez, e para o e-mail do CADASTRO — nunca para um endereço
   * escrito aqui. Um campo livre de destinatário num documento com o salário de
   * alguém é a fuga mais fácil de cometer sem se dar por ela.
   *
   * O servidor recusa o segundo envio e diz quando foi o primeiro; repetir é
   * possível, mas é uma decisão de quem está a olhar, e não um duplo clique.
   */
  async function enviarRecibo(l: Linha, reenviar = false) {
    setOcupado(true); setErro(null); setRecado(null);
    try {
      const r = await fetch(`/api/hr/companies/${clientId}/payslips`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year, period: periodo, freq: freqType, employeeId: l.employeeId, reenviar,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        const texto = j.codigo ? t(j.codigo as TKey, j.params) : (j.error || "Falhou.");
        if (j.codigo === "recibo.jaEnviado" && window.confirm(`${texto}\n\n${t("run.reenviar")}`)) {
          setOcupado(false);
          return enviarRecibo(l, true);
        }
        setErro(texto);
        return;
      }
      setRecado(t("run.enviado", { quem: l.nome, para: j.para }));
    } finally { setOcupado(false); }
  }

  async function acao(acao: "fechar" | "reabrir") {
    setOcupado(true); setErro(null); setRecado(null);
    try {
      const r = await fetch(`/api/hr/companies/${clientId}/payroll`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, period: periodo, freq: freqType, acao }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falhou."); return; }
      setRecado(acao === "fechar"
        ? [t("run.finalised", { n: j.gravados }), recadoDosTitulos(j.titulos)]
          .filter(Boolean).join(" ")
        : [t("run.reopened", { n: j.reabertos }), recadoDaRemocao(j.titulos)]
          .filter(Boolean).join(" "));
      await carregar();
    } finally { setOcupado(false); }
  }

  const fechado = (d?.linhas ?? []).some((l) => l.status === "final");
  const avisos = [...(d?.avisos ?? [])];

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("run.period")}</span>
          <select className="input mt-1 h-9 w-auto cursor-pointer py-0 text-[13px] font-semibold"
            value={periodo} onChange={(e) => setPeriodo(Number(e.target.value))}>
            {Array.from({ length: maxPeriodo }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        {d && (
          <p className="pb-2 text-[12.5px] text-muted">
            {t("run.payDate")}: <span className="font-mono">{d.payDate}</span>
          </p>
        )}
        {/*
          A opção das horas vive AQUI, ao lado dos recibos que ela muda.
          Enterrada num ecrã de configuração, ninguém a encontrava — e o pedido
          nasceu de olhar para um recibo, não para uma tela de definições.
        */}
        <label className="flex cursor-pointer items-center gap-2 pb-2 text-[12.5px]"
          title={t("run.showHoursHelp")}>
          <input type="checkbox" className="h-4 w-4 cursor-pointer" checked={horas}
            onChange={(e) => trocarHoras(e.target.checked)} />
          {t("run.showHours")}
        </label>
        <label className="flex cursor-pointer items-center gap-2 pb-2 text-[12.5px]"
          title={t("run.embutidoHelp")}>
          <input type="checkbox" className="h-4 w-4 cursor-pointer" checked={embutido}
            onChange={(e) => { setEmbutido(e.target.checked); setPdf(null); }} />
          {t("run.embutido")}
        </label>
        {!!(d?.linhas ?? []).length && (
          embutido ? (
            <button className="btn-ghost mb-1 h-9 px-4 text-sm"
              onClick={() => setPdf({ url: linkDoRecibo(), quem: t("run.payslipsAll") })}>
              {t("run.payslipsAll")}
            </button>
          ) : (
            <a className="btn-ghost mb-1 h-9 px-4 text-sm" href={linkDoRecibo()}
              target="_blank" rel="noopener noreferrer">
              {t("run.payslipsAll")}
            </a>
          )
        )}
      </div>

      {/* ------------------------------------------- o recibo, sem sair daqui */}
      {pdf && (
        <div className="mt-3 rounded-xl2 border border-line bg-surface-2/40">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
            <span className="text-[12.5px] font-medium">{pdf.quem}</span>
            <a className="ml-auto text-[12px] underline" href={pdf.url}
              target="_blank" rel="noopener noreferrer">{t("run.abrirSeparador")}</a>
            <button className="text-[12px] underline" onClick={() => setPdf(null)}>
              {t("common.close")}
            </button>
          </div>
          {/*
            `key` no url: sem ele, trocar de pessoa com o painel já aberto
            deixava o iframe a mostrar o recibo anterior — o navegador reaproveita
            o elemento e o PDF embutido não recarrega só por mudar o `src`.
          */}
          <iframe key={pdf.url} src={pdf.url} title={pdf.quem}
            className="h-[70vh] w-full rounded-b-xl2 border-0" />
        </div>
      )}

      {!!avisos.length && (
        <ul className="mt-3 space-y-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px]">
          {avisos.map((a, i) => <li key={i}>{t(a.codigo as TKey, a.params)}</li>)}
        </ul>
      )}
      {erro && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>}
      {recado && <p className="mt-3 rounded-lg border border-ok/40 bg-success-50 px-3 py-2 text-sm">{recado}</p>}

      <div className="-mx-1 mt-3 overflow-x-auto px-1">
        <table className="row-hover w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2 font-medium">{t("run.colEmployee")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colGross")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colPaye")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colUsc")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colPrsiEe")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colAe")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colNet")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colPrsiEr")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("run.colCost")}</th>
              <th className="px-3 py-2 font-medium">{t("run.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {(d?.linhas ?? []).map((l) => (
              <Fragment key={l.employeeId}>
              <tr className="border-b border-line/60 align-top">
                <td className="px-3 py-2">
                  <span className="font-medium">{l.nome}</span>
                  {l.jobTitle && <span className="ml-2 text-[11.5px] text-muted">{l.jobTitle}</span>}
                  {/* O aviso vive ao pé do nome de quem ele é. */}
                  {!!l.avisos.length && (
                    <ul className="mt-0.5 space-y-0.5 text-[11px] text-warning">
                      {l.avisos.map((a, i) => <li key={i}>· {t(a.codigo as TKey, a.params)}</li>)}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  <button type="button" className="underline decoration-dotted underline-offset-2"
                    title={t("run.verMemoria")}
                    onClick={() => setAberta(aberta === l.employeeId ? null : l.employeeId)}>
                    {eur(l.brutoCents)}
                  </button>
                </td>
                {/* PAYE negativo é DEVOLUÇÃO, e o cumulativo fá-la sozinho. */}
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${l.payeCents < 0 ? "text-ok" : ""}`}>
                  {eur(l.payeCents)}
                  {/*
                    O botao so aparece quando ha decisao a tomar: com devolucao
                    por pagar, ou com uma ja segura para soltar. Um botao sempre
                    visivel que na maior parte das vezes nao faz nada ensina a
                    ignora-lo.
                  */}
                  {l.status !== "final" && l.payeCents < 0 && (
                    <button className="mt-0.5 block w-full text-right text-[11px] underline"
                      disabled={ocupado} onClick={() => segurar(l, true)}>
                      {t("run.hold")}
                    </button>
                  )}
                  {l.status !== "final" && l.devolucaoSeguraCents > 0 && (
                    <button className="mt-0.5 block w-full text-right text-[11px] text-warning underline"
                      disabled={ocupado} onClick={() => segurar(l, false)}>
                      {t("run.release", { v: eur(l.devolucaoSeguraCents) })}
                    </button>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.uscCents)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.prsiEeCents)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(l.aeEeCents)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{eur(l.liquidoCents)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">{eur(l.prsiErCents)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">{eur(l.custoEmpregadorCents)}</td>
                <td className="px-3 py-2">
                  {l.status === "final" ? <span className="chip-ok">{t("run.final")}</span>
                    : <span className="chip">{t("run.draft")}</span>}
                  {/*
                    O recibo abre em separador novo, e não descarrega: quem
                    confere quer VER antes de entregar, e no telemóvel um
                    download é um ficheiro que se perde na pasta.
                  */}
                  {embutido ? (
                    <button className="mt-0.5 block text-[11px] underline"
                      onClick={() => setPdf({ url: linkDoRecibo(l.employeeId), quem: l.nome })}>
                      {t("run.payslip")}
                    </button>
                  ) : (
                    <a className="mt-0.5 block text-[11px] underline" href={linkDoRecibo(l.employeeId)}
                      target="_blank" rel="noopener noreferrer">
                      {t("run.payslip")}
                    </a>
                  )}
                  {/*
                    O botão de e-mail só existe com o recibo FECHADO. Um
                    rascunho traz o carimbo "não emitir" no próprio PDF, e
                    oferecer o envio de algo que o servidor vai recusar ensina
                    a desconfiar do botão.
                  */}
                  {l.status === "final" && (
                    <button className="mt-0.5 block text-[11px] underline" disabled={ocupado}
                      onClick={() => enviarRecibo(l)}>
                      {t("run.enviarEmail")}
                    </button>
                  )}
                </td>
              </tr>

              {/* ------------------------------ de onde vem este bruto */}
              {aberta === l.employeeId && (
                <tr className="border-b border-line/60 bg-surface-2/40">
                  <td colSpan={10} className="px-3 py-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                      {t("horas.memoria")}
                    </p>
                    {(l.memoria ?? []).length ? (
                      <table className="mt-2 text-[12.5px]">
                        <tbody>
                          {(l.memoria ?? []).map((m) => (
                            <Fragment key={m.semana}>
                              {m.parcelas.map((p, i) => (
                                <tr key={m.semana + ":" + i}>
                                  <td className="py-0.5 pr-4 font-mono text-muted">
                                    {i === 0 ? `${t("hr.weekShort")}${m.semana}` : ""}
                                  </td>
                                  <td className="py-0.5 pr-4">{t(p.chave as TKey)}</td>
                                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums">{p.horas} h</td>
                                  <td className="py-0.5 pr-2 text-muted">×</td>
                                  <td className="py-0.5 pr-4 text-right font-mono tabular-nums">{eur(p.taxaCents)}</td>
                                  <td className="py-0.5 text-right font-mono tabular-nums">{eur(p.valorCents)}</td>
                                </tr>
                              ))}
                              {/* Sem parcelas (contrato fixo, ou bruto escrito
                                  à mão) mostra-se o valor na mesma: uma semana
                                  que some do detalhe parece não ter sido paga. */}
                              {!m.parcelas.length && (
                                <tr>
                                  <td className="py-0.5 pr-4 font-mono text-muted">
                                    {t("hr.weekShort")}{m.semana}
                                  </td>
                                  <td className="py-0.5 pr-4 text-muted" colSpan={4}>
                                    {m.avisos.map((a) => t(a as TKey)).join(" · ") || "—"}
                                  </td>
                                  <td className="py-0.5 text-right font-mono tabular-nums">{eur(m.totalCents)}</td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                          <tr className="border-t border-line font-semibold">
                            <td className="py-1 pr-4" colSpan={5}>{t("horas.bruto")}</td>
                            <td className="py-1 text-right font-mono tabular-nums">{eur(l.brutoCents)}</td>
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <p className="mt-1 text-[12.5px] text-muted">{t("run.semHoras")}</p>
                    )}
                    {/* Os avisos das REGRAS — o domingo sem prémio, a regra de
                        extras por acabar. Ao pé da conta que eles explicam. */}
                    {Array.from(new Set((l.memoria ?? []).flatMap((m) => m.avisos))).map((a) => (
                      <p key={a} className="mt-1.5 text-[12px] text-warning">· {t(a as TKey)}</p>
                    ))}
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
            {!(d?.linhas ?? []).length && (
              <tr><td className="px-3 py-6 text-center text-muted" colSpan={10}>{t("run.nobody")}</td></tr>
            )}
          </tbody>
          {!!(d?.linhas ?? []).length && (
            <tfoot>
              <tr className="border-t-2 border-line font-semibold">
                <td className="px-3 py-2">{t("run.totals")}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.bruto)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.paye)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.usc)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.prsiEe)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.aeEe)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.liquido)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.prsiEr)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d!.totais.custoEmpregador)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-3 max-w-3xl text-[12px] text-muted">{t("run.finaliseHelp")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button className="btn-ghost h-9 px-4 text-sm" disabled={ocupado} onClick={carregar}>
          {t("run.preview")}
        </button>
        {fechado ? (
          <button className="btn-ghost h-9 px-4 text-sm text-danger" disabled={ocupado}
            onClick={() => acao("reabrir")}>
            {t("run.reopen")}
          </button>
        ) : (
          <button className="btn-primary h-9 px-4 text-sm"
            disabled={ocupado || !(d?.linhas ?? []).length} onClick={() => acao("fechar")}>
            {ocupado ? "…" : t("run.finalise")}
          </button>
        )}
      </div>
    </div>
  );
}
