import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { CONTAS_PADRAO } from "@/lib/accounting/post";
import { contasDeImposto, ehContaDeImposto } from "@/lib/fiscal/contasDeImposto";

/**
 * A conta de CONTROLO contra o aging: bate ou não bate.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO PRECISA DE ESTAR NO ECRÃ
 *
 * 2100 e 1200 não são contas transitórias — são de controlo, e a única coisa
 * que se lhes exige é que o saldo delas seja EXACTAMENTE a soma do que está
 * em aberto na lista de títulos. Se não for, uma das duas está errada, e não
 * há forma de saber qual olhando só para uma.
 *
 * A diferença apareceu a sério: a carga de abertura lançava 1200 e 2100 em
 * bloco, sem título por trás. O razão dizia 11.028,37, Contas a Receber dizia
 * 4.728,37, e a diferença de 6.300 era a abertura sem detalhe. Ninguém tinha
 * como descobrir isso pelo ecrã — as duas telas estavam certas, cada uma à sua
 * maneira, e só quem somasse as duas à mão veria o buraco.
 *
 * É a armadilha clássica de migração, e ela não avisa: o balanço continua a
 * fechar, porque o lançamento de abertura está balanceado. O que não fecha é
 * a conciliação, e essa ninguém faz se o ecrã não a fizer.
 * ---------------------------------------------------------------------------
 *
 * Uma diferença aqui NÃO é necessariamente erro — pode ser abertura por
 * detalhar, ou um lançamento manual legítimo naquela conta. Por isso o ecrã
 * mostra o número e não uma acusação: a decisão é de quem concilia.
 */

export type Conciliacao = {
  /** As contas que servem de controlo a este lado, já com as próprias dos títulos. */
  accounts: string[];
  /** Saldo das contas de controlo no razão, acumulado até hoje. */
  ledgerBalance: number;
  /** Soma do que está em aberto nos títulos deste lado. */
  agingOutstanding: number;
  /** razão − aging. Zero é o que se espera. */
  difference: number;
};

const PAGINA = 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Lê o saldo das contas de controlo, PAGINADO.
 *
 * O PostgREST corta em 1000 linhas sem avisar, e `account_balances` agrupa
 * por conta E por data — um cliente a sério passa disso no segundo ano. Sem
 * paginar, o saldo sairia menor e a diferença apareceria do nada, mandando
 * procurar um erro que não existe. Mesma lição de `lib/accounting/query.ts`.
 */
async function saldoDasContas(clientId: string, contas: string[]): Promise<number> {
  if (!contas.length) return 0;
  const sb = getServerSupabase();
  let total = 0;
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await sb.from("account_balances")
      .select("account_code,balance,posting_date")
      .eq("client_id", clientId)
      .in("account_code", contas)
      .order("posting_date", { ascending: true })
      .order("account_code", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as any[];
    for (const l of lote) total += Number(l.balance) || 0;
    if (lote.length < PAGINA) break;
  }
  return r2(total);
}

export async function conciliarControlo(
  clientId: string, kind: "payable" | "receivable"
): Promise<Conciliacao> {
  const sb = getServerSupabase();
  const padrao = kind === "payable" ? CONTAS_PADRAO.tradeCreditors : CONTAS_PADRAO.tradeDebtors;

  /*
   * As contas próprias dos títulos entram na conta.
   *
   * Um título pode ter conta de controlo própria (`ledger_items.account_code`),
   * para o escritório que separa fornecedores. Comparar só contra 2100 daria
   * uma diferença exactamente do tamanho desses títulos — um falso alarme que,
   * repetido, ensina a ignorar o aviso.
   */
  const { data: proprias } = await sb.from("ledger_items")
    .select("account_code,source_module")
    .eq("client_id", clientId).eq("kind", kind).not("account_code", "is", null);
  const titulos = (proprias ?? []) as any[];

  /*
   * As contas de IMPOSTO ficam de fora, dos dois lados.
   *
   * Desde que o imposto apurado passou a gerar título a pagar — com a conta de
   * IVA como controlo dele —, essa conta aparecia aqui e trazia consigo o saldo
   * ACUMULADO do imposto, para ser confrontado com um único título. Dava uma
   * diferença permanente, em todos os clientes, no ecrã que se abre todos os
   * dias.
   *
   * Não é o mesmo tipo de controlo: 812 e 711 controlam faturas de terceiros em
   * aberto; 845 controla a posição de imposto do período inteiro. Comparar as
   * duas é comparar coisas diferentes, e o resultado nunca fecharia.
   *
   * A lista NÃO é só a fixa: desde que a conta do imposto passou a ser escolhida
   * na tela, um título de imposto pode estar em 836, 844 ou 849. Por isso as
   * contas dos títulos do tipo `tax` juntam-se às quatro conhecidas — senão o
   * mesmo falso alarme voltaria na conta seguinte.
   */
  const deImposto = contasDeImposto(
    titulos.filter((t) => t.source_module === "tax").map((t) => t.account_code)
  );

  const contas = Array.from(new Set([
    padrao,
    ...titulos.map((t) => String(t.account_code).trim()).filter(Boolean),
  ])).filter((c) => !ehContaDeImposto(c, deImposto));

  const [ledgerBalance, { data: abertos }] = await Promise.all([
    saldoDasContas(clientId, contas),
    // Os títulos de imposto saem TAMBÉM daqui — excluir só a conta deixaria o
    // valor deles do lado dos títulos e a diferença apareceria ao contrário.
    sb.from("ledger_items_open").select("outstanding_amount,account_code")
      .eq("client_id", clientId).eq("kind", kind).limit(20000),
  ]);

  const agingOutstanding = r2(
    ((abertos ?? []) as any[])
      .filter((t) => !ehContaDeImposto(t.account_code, deImposto))
      .reduce((s, t) => s + (Number(t.outstanding_amount) || 0), 0)
  );

  return {
    accounts: contas,
    ledgerBalance,
    agingOutstanding,
    difference: r2(ledgerBalance - agingOutstanding),
  };
}
