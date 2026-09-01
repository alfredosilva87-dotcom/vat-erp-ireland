"use client";

/**
 * A CONCILIAÇÃO FISCAL, dentro das abas da Contabilidade.
 *
 * ---------------------------------------------------------------------------
 * POR QUE AQUI E NÃO NUMA TELA PRÓPRIA
 *
 * Começou como tela separada e o Alfredo apontou o sítio certo: as abas do
 * balancete. É onde o contabilista já está quando fecha o período, e o VAT e o
 * imposto são a mesma leitura do razão que o DRE e o balanço — só que
 * confrontada com o que vai na declaração.
 *
 * Uma tela à parte obrigaria a sair do fecho para conferir o fecho.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE PAINEL FAZ QUE NENHUM OUTRO FAZIA
 *
 * O sistema apurava o imposto por duas vias que nunca se olhavam: pelos
 * DOCUMENTOS (de onde sai a declaração) e pelo RAZÃO (de onde saem os livros).
 * Se a contabilização estivesse sempre certa dariam o mesmo número — não estão,
 * e nenhuma das três formas de divergir dá erro em lado nenhum: um documento
 * que entra no período e não é contabilizado, um contabilizado com outro valor,
 * ou um lançamento à mão sem documento.
 *
 * A diferença entre as duas vias é o único sítio onde isso aparece. É por isso
 * que a coluna da diferença é a mais visível da tela, e a única a vermelho.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { CT_TRADING } from "@/lib/fiscal/conciliacao";
import { memoriaDeCT, type LinhaDaMemoria } from "@/lib/fiscal/memoriaDeCalculo";

type Conta = { code: string; description: string; type?: string | null };

type Linha = {
  /* A chave vem do servidor; o texto sai do dicionário aqui. */
  chave: "vatOut" | "vatIn" | "taxRecognised";
  documentos: number; razao: number; diferenca: number; contas: string[];
};
export type Estado = "fecha" | "diverge" | "sem_movimento";
type Titulo = { id: string; ref: string; dueDate: string | null } | null;

type Dados = {
  de: string; ate: string;
  tituloVat: Titulo; tituloImposto: Titulo;
  cliente: { name: string; client_code: string | null; vat_number: string | null; legal_form: string | null };
  vat: {
    apuracao: { saidas: number; entradas: number; aPagar: number };
    linhas: Linha[]; estado: Estado; diferencaTotal: number;
  };
  imposto: {
    aplicavel: boolean;
    lucroAntesDeImposto: number; despesaDeImposto: number; lucroDepois: number;
    taxaEfetiva: number | null;
    linhas: Linha[]; estado: Estado; diferencaTotal: number;
  };
  error?: string;
};

const eur = (n: number) =>
  n.toLocaleString("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

const ANO = new Date().getFullYear();

export default function TaxPanel({ clientId, tipo }: { clientId: string; tipo: "vat" | "imposto" }) {
  const { t } = useT();
  const [de, setDe] = useState(`${ANO}-01-01`);
  const [ate, setAte] = useState(`${ANO}-12-31`);
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [criado, setCriado] = useState<string | null>(null);
  const [contas, setContas] = useState<Conta[]>([]);
  /*
   * As contas do título, escolhidas e não escritas no código.
   *
   * Estavam fixas — 845 para o IVA, 501/831 para o imposto sobre o lucro —, e
   * funcionam só para este plano. O próprio plano tem 836 (RCT), 844 (retenção
   * na fonte) e uma 849 que existe exactamente para o imposto que ele não
   * previu; um número escrito no código só se muda com um deploy.
   */
  const [contaImposto, setContaImposto] = useState(tipo === "vat" ? "845" : "831");
  /*
   * Vazio quer dizer "já lançado no fecho", e é por isso que o vazio é uma
   * opção com nome e não a ausência de escolha: lançar a despesa outra vez
   * dobrava-a no DRE, e é um erro que o balanço não denuncia.
   */
  const [contaDespesa, setContaDespesa] = useState("501");
  /*
   * Os três ajustes da memória de cálculo NÃO ficam gravados.
   *
   * Servem este quadro e o PDF que sai dele. Guardá-los pedia tabela nova e
   * uma decisão sobre o que fazer quando o lucro muda depois — e o que o
   * escritório faz de verdade é lançar o ajuste no razão. Ver
   * lib/fiscal/memoriaDeCalculo.ts para o que o sistema não sabe e por que não
   * o adivinha.
   */
  const [naoDedutivel, setNaoDedutivel] = useState("");
  const [naoTributavel, setNaoTributavel] = useState("");
  const [passivo, setPassivo] = useState("");

  /**
   * O imposto apurado vira um TÍTULO A PAGAR.
   *
   * É o passo que faltava entre saber quanto se deve e o dinheiro sair: a lista
   * de contas a pagar é o que alguém abre para decidir o que sai do banco esta
   * semana, e o imposto não estava lá. Ver lib/fiscal/tituloDeImposto.ts, onde
   * está por que o lançamento é diferente para os dois impostos.
   */
  async function criarTitulo(valor: number) {
    setCriando(true); setErro(null); setCriado(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/tax/titulo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo, de, ate, valor,
          conta_do_imposto: contaImposto,
          conta_de_despesa: tipo === "imposto" ? contaDespesa : null,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || t("tax.titleErr")); return; }
      setCriado(t("tax.titleMade", { n: j.ref, d: j.vencimento }));
      await carregar();
    } finally { setCriando(false); }
  }

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/tax?de=${de}&ate=${ate}`);
      const j = await r.json();
      if (!r.ok) { setErro(j.error || t("tax.loadErr")); setD(null); return; }
      setD(j);
    } finally { setCarregando(false); }
  }, [clientId, de, ate, t]);

  useEffect(() => { void carregar(); }, [carregar]);

  /* O plano COMPARTILHADO — é o que o motor contábil usa. Ver NovoTituloManual. */
  useEffect(() => {
    fetch(`/api/clients/${clientId}/accounts`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setContas((j?.ledgerAccounts ?? []) as Conta[]))
      .catch(() => setContas([]));
  }, [clientId]);

  return (
    <div className="space-y-4 p-5">
      {/*
        * Só o intervalo de datas — o título já é a aba, e o cabeçalho da tela
        * de contabilidade já diz de que cliente e de que exercício se trata.
        * Repetir isso aqui empurraria o quadro para fora do primeiro ecrã.
        */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-[12.5px] text-muted">{t("tax.subtitle")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wide text-muted">{t("common.from")}</span>
            <input type="date" className="input h-9 w-40" value={de} onChange={(e) => setDe(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wide text-muted">{t("common.to")}</span>
            <input type="date" className="input h-9 w-40" value={ate} onChange={(e) => setAte(e.target.value)} />
          </label>
          <button className="btn-ghost h-9 px-4 text-sm" disabled={carregando} onClick={carregar}>
            {carregando ? t("common.loading") : t("tax.refresh")}
          </button>
        </div>
      </div>

      {erro && (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>
      )}
      {criado && (
        <p className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm">{criado}</p>
      )}

      {!d ? (
        <p className="text-sm text-muted">{t("common.loading")}</p>
      ) : tipo === "vat" ? (
        <>
          {/* A apuração — o que a declaração vai dizer. */}
          <section className="card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-sm font-semibold">{t("tax.vatReturn")}</h2>
              <Link className="text-xs underline text-muted" href={`/clients/${clientId}/obligations`}>
                {t("tax.seeObligations")}
              </Link>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Cartao rotulo={t("tax.outputVat")} valor={eur(d.vat.apuracao.saidas)} />
              <Cartao rotulo={t("tax.inputVat")} valor={eur(d.vat.apuracao.entradas)} />
              {/*
                * Positivo é a pagar, negativo é a recuperar — e o rótulo muda
                * com o sinal. Um cartão fixo a dizer "a pagar" com um número
                * negativo obriga a pessoa a interpretar duas vezes.
                */}
              <Cartao
                rotulo={d.vat.apuracao.aPagar >= 0 ? t("tax.toPay") : t("tax.toRecover")}
                valor={eur(Math.abs(d.vat.apuracao.aPagar))}
                tom={d.vat.apuracao.aPagar >= 0 ? "brand" : "ok"}
              />
            </div>

            <BotaoDeTitulo
              clientId={clientId} t={t}
              titulo={d.tituloVat}
              /* Só se cria título do que há a PAGAR. Um período a recuperar não
                 é uma dívida — é um crédito, e um crédito em contas a pagar
                 seria uma dívida negativa que ninguém sabe ler. */
              valor={d.vat.apuracao.aPagar}
              criando={criando} onCriar={criarTitulo}
              contas={contas}
              contaImposto={contaImposto} setContaImposto={setContaImposto}
            />
          </section>

          <Confronto titulo={t("tax.vatCheck")} linhas={d.vat.linhas}
            estado={d.vat.estado} total={d.vat.diferencaTotal} t={t} />
        </>
      ) : !d.imposto.aplicavel ? (
        <section className="card p-6">
          <h2 className="font-display text-sm font-semibold">{t("tax.notApplicable")}</h2>
          {/*
            * Diz PORQUE não se aplica, e para onde o lucro vai.
            *
            * Um quadro a zeros lê-se como "não há imposto", e o empresário em
            * nome individual paga imposto — só que na pessoa, pela Form 11.
            */}
          <p className="mt-2 max-w-2xl text-sm text-muted">{t("tax.soleTraderNote")}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Cartao rotulo={t("tax.profit")} valor={eur(d.imposto.lucroAntesDeImposto)} tom="brand" />
          </div>
        </section>
      ) : (
        <>
          <section className="card p-5">
            <h2 className="font-display text-sm font-semibold">{t("tax.incomeSummary")}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Cartao rotulo={t("tax.profitBefore")} valor={eur(d.imposto.lucroAntesDeImposto)} />
              <Cartao rotulo={t("tax.taxCharge")} valor={eur(d.imposto.despesaDeImposto)} />
              <Cartao rotulo={t("tax.profitAfter")} valor={eur(d.imposto.lucroDepois)} tom="brand" />
              {/*
                * A taxa EFETIVA sai dos números, não da lei — e é ela que
                * denuncia o que uma comparação com os 12,5% não denuncia: uma
                * despesa lançada a mais, ou um lucro que mudou depois de o
                * imposto ter sido calculado.
                */}
              <Cartao
                rotulo={t("tax.effectiveRate")}
                valor={d.imposto.taxaEfetiva === null ? "—" : `${d.imposto.taxaEfetiva}%`}
                nota={d.imposto.taxaEfetiva === null ? t("tax.noProfit") : t("tax.tradingRate", { n: CT_TRADING })}
                tom={d.imposto.taxaEfetiva !== null && Math.abs(d.imposto.taxaEfetiva - CT_TRADING) > 5 ? "warn" : undefined}
              />
            </div>
          </section>

          <section className="card p-5">
            <BotaoDeTitulo
              clientId={clientId} t={t}
              titulo={d.tituloImposto}
              /* O imposto A PAGAR é o que foi lançado como despesa. Se ninguém
                 o lançou ainda, o botão propõe o cálculo pela taxa de trading —
                 mas quem decide é quem clica, e o valor vai à vista. */
              valor={d.imposto.despesaDeImposto > 0
                ? d.imposto.despesaDeImposto
                : Math.round(Math.max(0, d.imposto.lucroAntesDeImposto) * CT_TRADING) / 100}
              criando={criando} onCriar={criarTitulo}
              nota={d.imposto.despesaDeImposto > 0 ? undefined : t("tax.estimateNote", { n: CT_TRADING })}
              contas={contas}
              contaImposto={contaImposto} setContaImposto={setContaImposto}
              contaDespesa={contaDespesa} setContaDespesa={setContaDespesa}
            />
          </section>

          {/*
            * A MEMÓRIA DE CÁLCULO, entre o resumo e o confronto.
            *
            * Fica AQUI e não no fim porque é a explicação dos cartões que estão
            * logo acima: eles dizem o lucro e o imposto, e esta diz como se vai
            * de um ao outro. O confronto com o razão vem depois — é conferência,
            * e conferência lê-se quando já se percebeu a conta.
            */}
          <Memoria
            clientId={clientId} de={de} ate={ate} t={t}
            lucro={d.imposto.lucroAntesDeImposto}
            jaReconhecido={d.imposto.despesaDeImposto}
            naoDedutivel={naoDedutivel} setNaoDedutivel={setNaoDedutivel}
            naoTributavel={naoTributavel} setNaoTributavel={setNaoTributavel}
            passivo={passivo} setPassivo={setPassivo}
          />

          <Confronto titulo={t("tax.incomeCheck")} linhas={d.imposto.linhas}
            estado={d.imposto.estado} total={d.imposto.diferencaTotal} t={t} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ peças */

/**
 * O botão que transforma o apurado num título a pagar — ou o link para o que
 * já existe.
 *
 * Um botão que cria o mesmo título uma segunda vez seria pior do que não haver
 * botão: a duplicata só apareceria a quem fosse pagar. Por isso, criado o
 * título, o botão dá lugar ao caminho para ele.
 */
function BotaoDeTitulo({
  clientId, titulo, valor, criando, onCriar, nota, t,
  contas, contaImposto, setContaImposto, contaDespesa, setContaDespesa,
}: {
  clientId: string;
  titulo: { id: string; ref: string; dueDate: string | null } | null;
  valor: number; criando: boolean; onCriar: (v: number) => void; nota?: string;
  t: (k: any, v?: Record<string, string | number>) => string;
  contas: Conta[];
  contaImposto: string; setContaImposto: (v: string) => void;
  /* Só o imposto sobre o lucro tem despesa a reconhecer — no IVA a conta de
     controlo já a carrega, e oferecer o campo convidaria a dobrá-la. */
  contaDespesa?: string; setContaDespesa?: (v: string) => void;
}) {
  if (titulo) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-ok/40 bg-ok/5 px-3 py-2.5 text-[12.5px]">
        <span className="chip-ok text-[11px]">{t("tax.titleExists")}</span>
        <span className="font-mono">{titulo.ref}</span>
        {titulo.dueDate && <span className="text-muted">{t("tax.dueOn", { n: titulo.dueDate })}</span>}
        <Link className="underline" href={`/clients/${clientId}/payable?status=todos&q=${encodeURIComponent(titulo.ref)}`}>
          {t("tax.seePayable")}
        </Link>
      </div>
    );
  }
  if (valor <= 0) return null;

  const passivos = contas.filter((c) => c.type === "liability");
  const despesas = contas.filter((c) => c.type === "expense");

  return (
    <div className="mt-4 rounded-lg border border-line bg-surface-2 px-4 py-3.5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col leading-tight">
          <span className="label">{t("tax.taxAccount")}</span>
          <select className="input w-full text-[13px]" value={contaImposto}
            onChange={(e) => setContaImposto(e.target.value)}>
            {(passivos.length ? passivos : contas).map((c) => (
              <option key={c.code} value={c.code}>{c.code} · {c.description}</option>
            ))}
          </select>
          <span className="mt-1 text-[11px] text-muted">{t("tax.taxAccountHint")}</span>
        </label>

        {setContaDespesa && (
          <label className="flex flex-col leading-tight">
            <span className="label">{t("tax.expenseAccount")}</span>
            <select className="input w-full text-[13px]" value={contaDespesa ?? ""}
              onChange={(e) => setContaDespesa(e.target.value)}>
              {/* O vazio é uma escolha com nome: "já lançado no fecho". */}
              <option value="">{t("tax.expenseAlreadyPosted")}</option>
              {despesas.map((c) => (
                <option key={c.code} value={c.code}>{c.code} · {c.description}</option>
              ))}
            </select>
            <span className="mt-1 text-[11px] text-muted">{t("tax.expenseAccountHint")}</span>
          </label>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn-primary h-9 px-4 text-sm" disabled={criando} onClick={() => onCriar(valor)}>
          {criando ? t("common.saving") : t("tax.makeTitle", { n: eur(valor) })}
        </button>
        <span className="max-w-xl text-xs text-muted">{nota ?? t("tax.makeTitleHint")}</span>
      </div>
    </div>
  );
}

function Cartao({ rotulo, valor, nota, tom }: {
  rotulo: string; valor: string; nota?: string; tom?: "brand" | "ok" | "warn";
}) {
  const cor = tom === "brand" ? "text-brand" : tom === "ok" ? "text-ok" : tom === "warn" ? "text-warning" : "";
  return (
    <div className="rounded-xl2 border border-line bg-surface-2/50 px-4 py-3">
      <div className="text-[10.5px] uppercase tracking-wide text-muted">{rotulo}</div>
      <div className={`mt-1 font-display text-xl font-semibold tabular-nums ${cor}`}>{valor}</div>
      {nota && <div className="mt-0.5 text-[11px] text-muted">{nota}</div>}
    </div>
  );
}

/**
 * O QUADRO DO CONFRONTO — o coração da tela.
 *
 * Três colunas: o que os documentos dizem, o que o razão diz, e a falta. A
 * terceira é a que interessa, e por isso é a única que muda de cor.
 */
function Confronto({ titulo, linhas, estado, total, t }: {
  titulo: string; linhas: Linha[]; estado: Estado; total: number;
  t: (k: any, v?: Record<string, string | number>) => string;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h2 className="font-display text-sm font-semibold">{titulo}</h2>
        {estado === "sem_movimento" ? (
          <span className="chip text-[11px]">{t("tax.noMovement")}</span>
        ) : estado === "fecha" ? (
          <span className="chip-ok text-[11px]">{t("tax.balances")}</span>
        ) : (
          <span className="chip-danger text-[11px]">{t("tax.diverges", { n: eur(total) })}</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
              <th className="px-5 py-2 text-left font-medium">{t("tax.colWhat")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("tax.colDocs")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("tax.colLedger")}</th>
              <th className="px-5 py-2 text-right font-medium">{t("tax.colDiff")}</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const bate = l.diferenca === 0;
              return (
                <tr key={l.chave} className="border-b border-line/50 align-top">
                  <td className="px-5 py-3">
                    <div className="font-medium">{t(`tax.line_${l.chave}` as const)}</div>
                    <div className="mt-0.5 max-w-xl text-[11.5px] text-muted">
                      {t(`tax.lineNote_${l.chave}` as const)}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-muted">{l.contas.join(" · ")}</div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{eur(l.documentos)}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{eur(l.razao)}</td>
                  {/*
                    * A diferença é a coluna que se lê primeiro: maior, e a
                    * vermelho quando não é zero. Um zero fica discreto de
                    * propósito — o que se procura aqui é o que NÃO é zero.
                    */}
                  <td className={`px-5 py-3 text-right font-mono text-[15px] font-semibold tabular-nums
                    ${bate ? "text-muted" : "text-danger"}`}>
                    {eur(l.diferenca)}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-surface-2/40 text-[12.5px] font-semibold">
              <td className="px-5 py-2.5 text-right text-muted" colSpan={3}>{t("tax.totalDiff")}</td>
              <td className={`px-5 py-2.5 text-right font-mono tabular-nums
                ${total === 0 ? "text-muted" : "text-danger"}`}>
                {eur(total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {estado === "diverge" && (
        <div className="border-t border-line bg-danger/5 px-5 py-3 text-[12.5px]">
          {/* Dizer o que FAZER, e não só que está errado. */}
          <p className="font-medium text-danger">{t("tax.whatNow")}</p>
          <p className="mt-1 max-w-3xl text-muted">{t("tax.whatNowHint")}</p>
        </div>
      )}
    </section>
  );
}

/**
 * O QUADRO QUE EXPLICA O IMPOSTO, degrau a degrau.
 *
 * O painel já dizia o lucro e já dizia o imposto lançado. O que faltava era
 * como se vai de um ao outro — e é esse passo que o cliente pergunta quando
 * recebe a conta, e o que o contabilista tem de reproduzir se a Revenue
 * perguntar. Um número final sem os degraus acredita-se ou não; com os
 * degraus, discute-se.
 *
 * A conta está em lib/fiscal/memoriaDeCalculo.ts, que é puro e testado — aqui
 * só se recolhe o que ela precisa e se desenha o que ela devolve.
 */
function Memoria({
  clientId, de, ate, lucro, jaReconhecido, t,
  naoDedutivel, setNaoDedutivel, naoTributavel, setNaoTributavel, passivo, setPassivo,
}: {
  clientId: string; de: string; ate: string;
  lucro: number; jaReconhecido: number;
  t: (k: any, v?: Record<string, string | number>) => string;
  naoDedutivel: string; setNaoDedutivel: (v: string) => void;
  naoTributavel: string; setNaoTributavel: (v: string) => void;
  passivo: string; setPassivo: (v: string) => void;
}) {
  const n = (v: string) => Number(String(v).replace(",", ".")) || 0;
  const m = memoriaDeCT({
    lucroAntesDeImposto: lucro,
    naoDedutivel: n(naoDedutivel),
    naoTributavel: n(naoTributavel),
    rendimentoPassivo: n(passivo),
    jaReconhecido,
  });

  const params = new URLSearchParams({
    de, ate,
    nd: String(n(naoDedutivel)), nt: String(n(naoTributavel)), rp: String(n(passivo)),
  });

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-5 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="font-display text-sm font-semibold">{t("memo.title")}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">{t("memo.subtitle")}</p>
          </div>
          {/* O PDF sai da MESMA conta que está na tela — o papel que o cliente
              recebe não pode discordar do que o escritório está a ver. */}
          <a className="btn-ghost h-9 shrink-0 px-4 text-sm"
             href={`/api/clients/${clientId}/tax/memoria.pdf?${params}`}>
            {t("memo.pdf")}
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 border-b border-line bg-surface-2/50 px-5 py-3">
        <span className="w-full text-[10.5px] uppercase tracking-wide text-muted">{t("memo.inputs")}</span>
        <CampoDeAjuste rotulo={t("memo.notDeductible")} valor={naoDedutivel} aoMudar={setNaoDedutivel} />
        <CampoDeAjuste rotulo={t("memo.notTaxable")} valor={naoTributavel} aoMudar={setNaoTributavel} />
        <CampoDeAjuste rotulo={t("memo.passive")} valor={passivo} aoMudar={setPassivo} />
        <p className="w-full text-[11px] text-muted">{t("memo.notStored")}</p>
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full text-[13px]">
        <tbody>
          {m.linhas.map((l) => <Degrau key={l.chave} l={l} t={t} />)}
        </tbody>
      </table>
      </div>

      <div className="border-t border-line bg-surface-2/60 px-5 py-2.5 text-[12px] text-muted">
        {m.prejuizo
          ? t("memo.loss")
          : m.taxaEfetiva !== null
            ? t("memo.effective", { n: m.taxaEfetiva })
            : ""}
        {m.porReconhecer < 0 && <span className="ml-2 text-warning">{t("memo.over")}</span>}
      </div>
    </section>
  );
}

function CampoDeAjuste({ rotulo, valor, aoMudar }: {
  rotulo: string; valor: string; aoMudar: (v: string) => void;
}) {
  return (
    <label className="flex flex-col leading-tight">
      <span className="label">{rotulo}</span>
      <input className="input h-9 w-36 text-right font-mono text-[13px]" placeholder="0,00"
        value={valor} onChange={(e) => aoMudar(e.target.value)} />
    </label>
  );
}

/**
 * Um degrau da conta.
 *
 * Os subtotais e o total ficam a negrito com fundo, os ajustes recuados: a
 * hierarquia visual é a própria conta, e sem ela nove linhas iguais obrigam a
 * ler tudo para achar o resultado.
 */
function Degrau({ l, t }: {
  l: LinhaDaMemoria;
  t: (k: any, v?: Record<string, string | number>) => string;
}) {
  const forte = l.tipo === "subtotal" || l.tipo === "total";
  const recuado = l.tipo === "ajuste";
  return (
    <tr className={`border-b border-line/70 ${forte ? "bg-surface-2/40 font-semibold" : ""}`}>
      <td className={`px-5 py-2 ${recuado ? "pl-9 text-muted" : ""}`}>
        {t(("memo." + l.chave) as any)}
        {/* A base e a alíquota vão ao lado do rótulo, não numa coluna própria:
            só duas das nove linhas as têm, e uma coluna quase vazia lê-se pior
            do que um parêntese. */}
        {l.tipo === "taxa" && (
          <span className="ml-2 font-mono text-[11.5px] font-normal text-muted">
            {eur(l.base ?? 0)} {t("memo.at", { n: l.taxa ?? 0 })}
          </span>
        )}
      </td>
      <td className={`px-5 py-2 text-right font-mono tabular-nums ${
        l.tipo === "total" ? "text-brand" : recuado ? "text-muted" : ""
      }`}>
        {eur(l.valor)}
      </td>
    </tr>
  );
}
