import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import {
  balanceSheet, checkEquation, profitAndLoss,
  type LinhaDeRelatorio, type SaldoDeConta,
} from "@/lib/accounting/reports";

/**
 * A montagem dos relatórios, num lugar só.
 *
 * A tela, o PDF e o Excel chamam esta função — nenhum deles refaz a
 * consulta nem a soma. É o que impede o arquivo entregue ao cliente de
 * discordar do que a pessoa viu antes de clicar em exportar, que é o
 * tipo de divergência que ninguém encontra até alguém comparar dois
 * papéis lado a lado.
 */

export type Relatorios = {
  from: string;
  to: string;
  client: { name: string; client_code: string | null; vat_number: string | null; cro: string | null } | null;
  trialBalance: (SaldoDeConta & { side: "debit" | "credit" })[];
  profitAndLoss: LinhaDeRelatorio[];
  profit: number;
  balanceSheet: LinhaDeRelatorio[];
  netAssets: number;
  capitalAndReserves: number;
  balances: boolean;
  difference: number;
  /**
   * A última data com lançamento, dentro do recorte.
   *
   * É o que diz ATÉ ONDE o relatório tem dado — e não `new Date()`, que num
   * exercício em curso responde "hoje" mesmo que o último documento tenha
   * entrado há três semanas. Serve o aviso de exercício em curso nos exports.
   */
  lastPosting: string | null;
  equation: ReturnType<typeof checkEquation>;
};

/**
 * Os saldos por conta e data, TODOS.
 *
 * O PostgREST devolve no máximo 1000 linhas por pedido e não avisa quando
 * corta. Como a vista agrupa por conta E por data de lançamento, um cliente
 * com movimento a sério passa desse teto no segundo ano — e aí o balanço sai
 * errado em silêncio: sem erro, sem aviso, só a diferença no rodapé, que se lê
 * como lançamento torto e manda o contabilista procurar no sítio errado.
 *
 * Por isso pagina-se até ao fim, com ordem estável. Um `.range(0, 100000)`
 * calaria o sintoma nesta base e voltaria a partir quando um cliente crescesse
 * mais do que o número escolhido à mão.
 */
const PAGINA = 1000;

async function saldosAte(clientId: string, ate: string): Promise<any[]> {
  const sb = getServerSupabase();
  const todas: any[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await sb.from("account_balances")
      .select("account_code,account_name,type,report_group,posting_date,debit,credit,balance")
      .eq("client_id", clientId)
      .lte("posting_date", ate)
      .order("posting_date", { ascending: true })
      .order("account_code", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as any[];
    todas.push(...lote);
    if (lote.length < PAGINA) return todas;
  }
}

export async function loadReports(
  clientId: string, de: string, ate: string
): Promise<Relatorios> {
  const sb = getServerSupabase();

  const [{ data: cliente }, linhas] = await Promise.all([
    sb.from("clients").select("name,client_code,vat_number,cro").eq("id", clientId).maybeSingle(),
    saldosAte(clientId, ate),
  ]);

  const juntar = (filtro: (l: any) => boolean): SaldoDeConta[] => {
    const mapa = new Map<string, SaldoDeConta>();
    for (const l of linhas) {
      if (!filtro(l) || !l.type) continue;
      const atual = mapa.get(l.account_code) ?? {
        account_code: l.account_code, account_name: l.account_name,
        type: l.type, report_group: l.report_group || "administrative_expenses", balance: 0,
      };
      atual.balance = Math.round((atual.balance + Number(l.balance || 0)) * 100) / 100;
      mapa.set(l.account_code, atual);
    }
    return Array.from(mapa.values()).sort((a, b) => a.account_code.localeCompare(b.account_code));
  };

  /*
   * Os dois recortes são diferentes, e isso é contabilidade e não
   * detalhe de implementação:
   *
   *   - o DRE é o MOVIMENTO do período
   *   - o balanço é o SALDO ACUMULADO até a data final
   *
   * Usar o mesmo recorte nos dois faz o balanço perder os saldos de
   * abertura e não fechar.
   */
  const doPeriodo = juntar((l) => l.posting_date >= de && l.posting_date <= ate);
  const acumulado = juntar(() => true);

  const dre = profitAndLoss(doPeriodo);

  /*
   * O DRE leva o lucro DO PERÍODO; o balanço leva o ACUMULADO. São números
   * diferentes e é essa a razão de haver duas chamadas aqui.
   *
   * Enquanto não existe lançamento de encerramento, o lucro dos anos passados
   * fica nas contas de resultado e não chega ao património por si. O lado do
   * ativo, esse, já vem acumulado desde sempre. Levar ao património só o lucro
   * do ano deixaria o balanço fora por exatamente a soma dos lucros dos anos
   * anteriores — e com um ano só de razão isso nunca aparece, que é o que faz
   * o erro sobreviver ao primeiro exercício e explodir no segundo.
   *
   * Se um dia houver encerramento, isto continua certo: o resultado passa a
   * estar em `profit_loss_account` e o acumulado das contas de resultado desse
   * período fica zero, sem dupla contagem.
   */
  const lucroAcumulado = profitAndLoss(acumulado).profit;
  const bs = balanceSheet(acumulado, lucroAcumulado);

  return {
    from: de, to: ate,
    client: (cliente as any) ?? null,
    trialBalance: acumulado
      .filter((s) => s.balance !== 0)
      .map((s) => ({ ...s, side: (["asset", "expense"].includes(s.type) ? "debit" : "credit") as "debit" | "credit" })),
    profitAndLoss: dre.lines,
    profit: dre.profit,
    balanceSheet: bs.lines,
    netAssets: bs.netAssets,
    capitalAndReserves: bs.capitalAndReserves,
    balances: bs.balances,
    difference: bs.difference,
    lastPosting: linhas.reduce<string | null>(
      (max, l) => (l.posting_date && (!max || l.posting_date > max) ? l.posting_date : max), null),
    equation: checkEquation(acumulado),
  };
}

/** O recorte de datas de um ano, no formato que o resto do módulo usa. */
export function periodoDoAno(ano: number): { de: string; ate: string } {
  return { de: `${ano}-01-01`, ate: `${ano}-12-31` };
}
