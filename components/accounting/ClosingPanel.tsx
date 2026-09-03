"use client";

/**
 * A ROTINA DE FECHAMENTO, dentro das abas da contabilidade.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA TELA TEM DE FAZER, E QUE UM BOTÃO NÃO FAZ
 *
 * Fechar um mês é dizer "este é o número, e ninguém mexe mais". Se a tela for
 * só um botão, quem carrega não sabe sobre o que está a fechar — e o cadeado
 * passa a proteger o erro em vez do número.
 *
 * Por isso o centro da tela é a LISTA DE VERIFICAÇÕES, e o botão é a
 * consequência dela. Cada linha diz o que se mediu, quanto deu, e se impede ou
 * apenas avisa. O que impede fica a vermelho e desliga o botão; o que avisa
 * fica registado no fecho, para responder ao "porquê" seis meses depois.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

type Verificacao = {
  chave: string;
  gravidade: "impede" | "avisa";
  valor: number;
  contas?: string[];
};
type Periodo = {
  id: string; periodStart: string; periodEnd: string;
  closedAt: string; note: string | null; checks: Verificacao[] | null;
};
type Estado = {
  de: string; ate: string;
  verificacoes: Verificacao[];
  pode: boolean;
  fechado: Periodo | null;
  fechadoAte: string | null;
  periodos: Periodo[];
  error?: string;
};

/* As que se contam, por oposição às que se somam em euros. */
const CONTAGEM = new Set([
  "porConferir", "meiasIntegracoes", "bancoPorFechar", "mesAnteriorAberto",
]);

const eur = (n: number) =>
  n.toLocaleString("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

export default function ClosingPanel({ clientId, ano }: { clientId: string; ano: number }) {
  const { t } = useT();
  const [mes, setMes] = useState(() => new Date().getUTCMonth() + 1);
  const [d, setD] = useState<Estado | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [reabrindo, setReabrindo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/closing?ano=${ano}&mes=${mes}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || t("close.loadErr")); setD(null); return; }
      setD(j);
    } finally { setCarregando(false); }
  }, [clientId, ano, mes, t]);

  /*
   * TROCAR DE MÊS APAGA OS INDICADORES DO MÊS ANTERIOR.
   *
   * Sem isto, `d` continuava a segurar os números do mês de onde se veio
   * enquanto os novos vinham a caminho — e como o painel só mostrava o
   * esqueleto quando `d` era nulo, o utilizador via as oito verificações
   * `clean`, a frase "Everything checks out for this month" e o botão a mudar
   * de rótulo para `Close Jul` e a ficar **clicável**. Carregar nessa janela
   * fechava Julho com base nos números de Setembro, e o fecho tranca o razão no
   * banco de dados.
   *
   * A janela é curta; o gesto é natural (clicar no mês e no botão logo abaixo).
   */
  useEffect(() => { setD(null); setMsg(null); setErro(null); }, [ano, mes]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function fechar() {
    /*
     * A ASSIMETRIA ESTAVA INVERTIDA.
     *
     * Apagar uma venda perguntava "Excluir esta venda?"; fechar um mês — que
     * tranca o razão NO BANCO DE DADOS — não perguntava nada, um clique único.
     * A acção pequena e reversível avisava, a grande não.
     *
     * O resumo não é enfeite: diz quantos lançamentos e que valor ficam
     * trancados, que é a informação com que se decide se é mesmo este o mês.
     */
    const nomeMes = t(("close.m" + mes) as any);
    const linhas = [
      t("close.confirmTitle", { mes: nomeMes, ano: String(ano) }),
      "",
      t("close.confirmLock"),
    ];
    if (avisa.length) linhas.push(t("close.confirmWarnings", { n: String(avisa.length) }));
    if (!confirm(linhas.join("\n"))) return;

    setGravando(true); setErro(null); setMsg(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/closing`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ano, mes, note: nota }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || t("close.closeErr")); await carregar(); return; }
      setMsg(t("close.closed"));
      setNota("");
      await carregar();
    } finally { setGravando(false); }
  }

  async function reabrir(id: string) {
    // O botão deixou de estar `disabled`: um botão que não reage e não diz nada
    // lê-se como avariado. A validação existia — só não se via.
    if (!motivo.trim()) { setErro(t("close.reopenNeedsReason")); return; }
    setGravando(true); setErro(null); setMsg(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/closing`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, motivo }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || t("close.reopenErr")); return; }
      setReabrindo(null); setMotivo("");
      setMsg(t("close.reopened"));
      await carregar();
    } finally { setGravando(false); }
  }

  const fechadoNesteMes = (m: number) => {
    const chave = `${ano}-${String(m).padStart(2, "0")}`;
    return (d?.periodos ?? []).some((p) => p.periodStart.slice(0, 7) === chave);
  };

  const impede = (d?.verificacoes ?? []).filter((v) => v.gravidade === "impede" && Math.abs(v.valor) > 0.004);
  const avisa = (d?.verificacoes ?? []).filter((v) => v.gravidade === "avisa" && Math.abs(v.valor) > 0.004);

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-[12.5px] text-muted">{t("close.subtitle")}</p>
        {d?.fechadoAte && (
          <span className="chip chip-ok text-[11px]">{t("close.lockedThrough", { n: d.fechadoAte })}</span>
        )}
      </div>

      {/*
        * Os doze meses de uma vez, com o estado de cada um.
        *
        * O mês fechado tem de se ver SEM abrir: é a pergunta que se faz ao
        * entrar aqui ("onde é que isto vai?"), e uma tela que só mostra o mês
        * selecionado obriga a doze cliques para a responder.
        */}
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const fechado = fechadoNesteMes(m);
          const activo = m === mes;
          return (
            <button key={m} onClick={() => setMes(m)}
              className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                activo ? "border-brand bg-brand-50 text-brand-700"
                : fechado ? "border-ok/40 bg-ok/5 text-ink" : "border-line bg-surface-2 text-muted"
              }`}>
              {t(("close.m" + m) as any)}
              {fechado && <span className="ml-1.5 text-ok">●</span>}
            </button>
          );
        })}
      </div>

      {erro && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>}
      {msg && <p className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm">{msg}</p>}

      {carregando && !d ? (
        <p className="text-sm text-muted">{t("common.loading")}</p>
      ) : !d ? null : d.fechado ? (
        <section className="card border-l-4 border-l-success p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="chip chip-ok text-[11px]">{t("close.isClosed")}</span>
            <span className="text-sm text-muted">
              {t("close.closedOn", { n: d.fechado.closedAt.slice(0, 10) })}
            </span>
            {d.fechado.note && <span className="text-sm">{d.fechado.note}</span>}
          </div>
          {/*
            * O que se sabia na hora — e não uma medição de agora.
            * Ver `estadoDoFechamento`: remedir daria a impressão de um problema
            * novo num mês que já não se pode mexer.
            */}
          {!!d.fechado.checks?.length && (
            <Lista verificacoes={d.fechado.checks.filter((v) => Math.abs(v.valor) > 0.004)} t={t} vazioOk />
          )}

          {reabrindo === d.fechado.id ? (
            <div className="mt-4 rounded-lg border border-warning/40 bg-warning/5 p-3">
              <p className="text-[12.5px]">{t("close.reopenAsk")}</p>
              <input className="input mt-2 w-full text-[13px]" value={motivo}
                onChange={(e) => setMotivo(e.target.value)} placeholder={t("close.reopenReason")} />
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn-primary h-8 px-3 text-xs" disabled={gravando}
                  onClick={() => reabrir(d.fechado!.id)}>
                  {gravando ? t("common.saving") : t("close.reopenBtn")}
                </button>
                <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setReabrindo(null)}>
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn-ghost mt-4 h-8 px-3 text-xs" onClick={() => setReabrindo(d.fechado!.id)}>
              {t("close.reopen")}
            </button>
          )}
        </section>
      ) : (
        <>
          <section className="card p-5">
            <h2 className="font-display text-sm font-semibold">{t("close.checks")}</h2>
            <Lista verificacoes={d.verificacoes} t={t} />
          </section>

          <section className={`card border-l-4 p-5 ${impede.length ? "border-l-danger" : "border-l-success"}`}>
            {impede.length ? (
              <p className="text-sm text-danger">{t("close.blocked", { n: impede.length })}</p>
            ) : (
              <>
                <p className="text-sm">
                  {avisa.length ? t("close.readyWithWarnings", { n: avisa.length }) : t("close.ready")}
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="flex flex-1 flex-col leading-tight sm:max-w-md">
                    <span className="label">{t("close.note")}</span>
                    <input className="input w-full text-[13px]" value={nota}
                      onChange={(e) => setNota(e.target.value)} placeholder={t("close.notePlaceholder")} />
                  </label>
                  <button className="btn-primary h-9 px-4 text-sm" disabled={gravando || carregando} onClick={fechar}>
                    {gravando ? t("common.saving") : t("close.closeBtn", { n: t(("close.m" + mes) as any) })}
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted">{t("close.lockHint")}</p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/**
 * Uma verificação por linha, com o número que a mediu.
 *
 * O número está sempre à vista, mesmo quando é zero: "documentos por conferir:
 * 0" é uma afirmação, e uma lista que esconde os zeros deixa de o ser — quem
 * lê não sabe se foi medido e deu zero, ou se não foi medido.
 */
function Lista({ verificacoes, t, vazioOk }: {
  verificacoes: Verificacao[];
  t: (k: any, v?: Record<string, string | number>) => string;
  vazioOk?: boolean;
}) {
  if (!verificacoes.length) {
    return vazioOk ? null : <p className="mt-3 text-sm text-muted">{t("close.allClean")}</p>;
  }
  return (
    <ul className="mt-3 divide-y divide-line/70">
      {verificacoes.map((v) => {
        const limpo = Math.abs(v.valor) <= 0.004;
        const cor = limpo ? "text-ok" : v.gravidade === "impede" ? "text-danger" : "text-warning";
        return (
          <li key={v.chave} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
            <span className={`chip text-[10px] ${limpo ? "chip-ok" : v.gravidade === "impede" ? "chip-danger" : "chip-warn"}`}>
              {limpo ? t("close.ok") : v.gravidade === "impede" ? t("close.impedes") : t("close.warns")}
            </span>
            <span className="text-[13px] font-medium">{t(("close.chk_" + v.chave) as any)}</span>
            <span className={`font-mono text-[13px] tabular-nums ${cor}`}>
              {CONTAGEM.has(v.chave) ? v.valor : eur(v.valor)}
            </span>
            {!!v.contas?.length && (
              <span className="font-mono text-[11px] text-muted">{v.contas.join(", ")}</span>
            )}
            <span className="w-full text-[11.5px] text-muted">{t(("close.chkNote_" + v.chave) as any)}</span>
          </li>
        );
      })}
    </ul>
  );
}
