import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { loadReports, periodoDoAno, type Relatorios } from "@/lib/accounting/query";

/**
 * O ano contra o ano anterior.
 *
 * O razão guarda por data, então o comparativo não precisa de tabela nova nem
 * de fotografia gravada no fecho: é a MESMA `loadReports` chamada noutro
 * recorte. Guardar o ano anterior num sítio à parte pareceria mais rápido e
 * criaria a divergência clássica — corrigir um lançamento de 2025 mudaria o
 * relatório de 2025 e não mudaria a coluna "2025" impressa ao lado de 2026.
 *
 * A visão ENXUTA não carrega nada disto. É a cópia de trabalho, para conferir
 * número, e puxar dois anos extra do razão para os deitar fora seria pagar
 * três vezes a consulta mais cara do módulo.
 */

export type Visao = "enxuta" | "completa";
export const VISOES: Visao[] = ["enxuta", "completa"];
export const ehVisao = (v: unknown): v is Visao => VISOES.includes(v as Visao);

/** Os dados do escritório impressos no timbre. Tudo pode faltar. */
export type Timbre = {
  name: string;
  address: string | null; phone: string | null; website: string | null;
  contact_email: string | null; registration_no: string | null;
  signer_name: string | null; signer_title: string | null;
};

export type PontoDaSerie = {
  ano: number; turnover: number; grossProfit: number; profit: number; margem: number;
};

export type Kpi = {
  key: string;
  label: string;
  valor: number;
  anterior: number | null;
  /** Variação percentual; em pontos percentuais quando o KPI já é uma taxa. */
  variacao: number | null;
  formato: "money" | "pct";
  /** Em pontos percentuais, e não em percentagem de percentagem. */
  variacaoEmPontos?: boolean;
  /** Substitui a percentagem quando ela não diria nada de útil. */
  nota?: string | null;
};

export type Comparativo = {
  ano: number;
  visao: Visao;
  atual: Relatorios;
  anterior: Relatorios | null;
  serie: PontoDaSerie[];
  kpis: Kpi[];
  escritorio: Timbre | null;
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const rubrica = (r: Relatorios, key: string): number =>
  r.profitAndLoss.find((l) => l.key === key)?.amount ?? 0;

const margemDe = (r: Relatorios): number => {
  const t = rubrica(r, "turnover");
  // Sem faturação não há margem — zero seria uma resposta, e é a errada:
  // diria "margem nula" onde a verdade é "não se aplica".
  return t === 0 ? 0 : r2((r.profit / t) * 100);
};

const ponto = (r: Relatorios, ano: number): PontoDaSerie => ({
  ano,
  turnover: rubrica(r, "turnover"),
  grossProfit: rubrica(r, "gross_profit"),
  profit: r.profit,
  margem: margemDe(r),
});

/**
 * A variação percentual entre dois números.
 *
 * Devolve nulo quando a base é zero ou negativa. Não é preciosismo: um lucro
 * que sai de -2.000 para 1.000 daria "-150%" pela fórmula, e o relatório
 * anunciaria uma queda no ano em que a empresa passou a dar lucro. Nesses
 * casos o honesto é não mostrar percentagem nenhuma e deixar os dois valores
 * falarem.
 */
function variacao(atual: number, anterior: number | null): number | null {
  if (anterior === null || anterior <= 0) return null;
  return r2(((atual - anterior) / anterior) * 100);
}

/** O resultado trocou de sinal entre os dois períodos? */
const virou = (atual: number, anterior: number | null): boolean =>
  anterior !== null && anterior !== 0 && atual !== 0 && Math.sign(atual) !== Math.sign(anterior);

function montarKpis(atual: Relatorios, anterior: Relatorios | null): Kpi[] {
  const a = (key: string) => rubrica(atual, key);
  const p = (key: string) => (anterior ? rubrica(anterior, key) : null);
  const margemAtual = margemDe(atual);
  const margemAnterior = anterior ? margemDe(anterior) : null;

  return [
    {
      key: "turnover", label: "Turnover", formato: "money",
      valor: a("turnover"), anterior: p("turnover"),
      variacao: variacao(a("turnover"), p("turnover")),
    },
    {
      key: "gross_profit", label: "Gross profit", formato: "money",
      valor: a("gross_profit"), anterior: p("gross_profit"),
      variacao: variacao(a("gross_profit"), p("gross_profit")),
    },
    {
      key: "profit", label: "Profit for the year", formato: "money",
      valor: atual.profit, anterior: anterior ? anterior.profit : null,
      /*
       * Quando o resultado troca de sinal, a percentagem não se imprime.
       *
       * Um lucro de 2.253 que vira prejuízo de 24.888 dá "-1.204,7%" pela
       * fórmula. O número está certo e não informa nada: quem lê um cartão de
       * KPI não converte mil e duzentos por cento em "passou a dar prejuízo",
       * que é a única coisa que ali interessa. Então diz-se isso por extenso.
       */
      variacao: virou(atual.profit, anterior?.profit ?? null)
        ? null : variacao(atual.profit, anterior ? anterior.profit : null),
      nota: virou(atual.profit, anterior?.profit ?? null)
        ? (atual.profit < 0 ? "swung to loss" : "swung to profit") : null,
    },
    {
      key: "margin", label: "Net margin", formato: "pct",
      valor: margemAtual, anterior: margemAnterior,
      // Margem que sai de 4% para 6% subiu DOIS PONTOS, não cinquenta por
      // cento. As duas leituras são defensáveis e uma delas engana — pontos
      // percentuais é a que um contabilista espera ver.
      variacao: margemAnterior === null ? null : r2(margemAtual - margemAnterior),
      variacaoEmPontos: true,
    },
  ];
}

/** Exportada porque o razão imprime no mesmo papel timbrado. */
export async function timbreDoCliente(clientId: string): Promise<Timbre | null> {
  const sb = getServerSupabase();
  const { data: cliente } = await sb.from("clients").select("company_id").eq("id", clientId).maybeSingle();
  const companyId = (cliente as any)?.company_id;
  const colunas = "name,address,phone,website,contact_email,registration_no,signer_name,signer_title";

  // Sem `company_id` no cliente (instalação de escritório único, que é o caso
  // normal do self-host) usa-se a empresa que existe. Sair sem timbre porque
  // falta uma ligação que nunca foi preenchida seria pior do que adivinhar
  // bem num cenário onde só há uma resposta possível.
  const q = companyId
    ? sb.from("companies").select(colunas).eq("id", companyId).maybeSingle()
    : sb.from("companies").select(colunas).limit(1).maybeSingle();

  const { data } = await q;
  return (data as any) ?? null;
}

export async function loadComparative(
  clientId: string, ano: number, visao: Visao, anosDeSerie = 3
): Promise<Comparativo> {
  const p = periodoDoAno(ano);

  if (visao === "enxuta") {
    const [atual, escritorio] = await Promise.all([
      loadReports(clientId, p.de, p.ate), timbreDoCliente(clientId),
    ]);
    return { ano, visao, atual, anterior: null, serie: [ponto(atual, ano)], kpis: [], escritorio };
  }

  const anos = Array.from({ length: anosDeSerie }, (_, i) => ano - (anosDeSerie - 1 - i));
  const [relatorios, escritorio] = await Promise.all([
    Promise.all(anos.map((y) => {
      const r = periodoDoAno(y);
      return loadReports(clientId, r.de, r.ate);
    })),
    timbreDoCliente(clientId),
  ]);

  const atual = relatorios[relatorios.length - 1];
  const anteriorBruto = relatorios[relatorios.length - 2] ?? null;

  /*
   * Um ano sem movimento nenhum NÃO é comparativo.
   *
   * Um cliente que entrou no escritório este ano tem zero em toda a coluna do
   * ano passado, e isso imprimiria "-100%" em cada linha — a leitura de uma
   * empresa que fechou, quando a verdade é que ainda não havia histórico. Sem
   * base, a coluna não sai.
   */
  const temMovimento = (r: Relatorios | null) =>
    !!r && (rubrica(r, "turnover") !== 0 || r.profit !== 0 || r.trialBalance.length > 0);
  const anterior = temMovimento(anteriorBruto) ? anteriorBruto : null;

  /*
   * Para os GRÁFICOS o critério é outro: tem de haver negócio, e não apenas
   * saldos.
   *
   * A carga de abertura é um lançamento datado de 31/12 do ano anterior ao
   * primeiro exercício. Pelo critério do comparativo esse ano "tem movimento"
   * — tem o balancete todo — e entrava na série como uma coluna a zero, a
   * gastar um terço da largura do gráfico a informar que a empresa ainda não
   * negociava. Na coluna comparativa do BALANÇO aquele ano continua a fazer
   * sentido, porque ali os saldos de abertura são exatamente o que se quer
   * ver; num gráfico de faturação, não.
   */
  const temNegocio = (r: Relatorios) => rubrica(r, "turnover") !== 0 || r.profit !== 0;

  return {
    ano, visao, atual, anterior,
    serie: relatorios
      .map((r, i) => ({ p: ponto(r, anos[i]), negocia: temNegocio(r) }))
      .filter((x, i) => i === relatorios.length - 1 || x.negocia)
      .map((x) => x.p),
    kpis: montarKpis(atual, anterior),
    escritorio,
  };
}
