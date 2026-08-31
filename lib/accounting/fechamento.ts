import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { loadReports } from "./query";
import { conciliacaoFiscal } from "@/lib/fiscal/conciliacaoDados";
import { conciliarControlo } from "@/lib/financial/control";
import { documentosNaoIntegrados } from "@/lib/financial/naoIntegrados";
import {
  impedimentos, podeFechar, verificacao, mesesEntre, fechadoAte, type Verificacao,
} from "./fechamentoPuro";
import { periodosFechados, paraPuro, type PeriodoGravado } from "./periodos";

/**
 * O FECHAMENTO CONTÁBIL — a parte que fala com o banco.
 *
 * A política está em `fechamentoPuro.ts`; aqui mede-se o que ela julga, e
 * grava-se o resultado. O cadeado em si não está em nenhum dos dois: está no
 * gatilho de `journal` (ver selfhost/schema/039), porque a aplicação escreve no
 * razão por caminhos demais para confiar numa verificação por caminho.
 */

export { podeFechar, impedimentos } from "./fechamentoPuro";
export type { Verificacao } from "./fechamentoPuro";
export { periodosFechados, periodoTravado } from "./periodos";
export type { PeriodoGravado } from "./periodos";

const sb = () => getServerSupabase();
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// --------------------------------------------------------------- as medições

/**
 * Mede tudo o que a política julga, para um mês.
 *
 * Cada medição é uma pergunta ao banco e não a um valor guardado: um fecho que
 * se decide por números em cache fecha sobre o que era verdade há uma hora.
 */
export async function verificacoesDoPeriodo(
  clientId: string, de: string, ate: string
): Promise<Verificacao[]> {
  // O razão inteiro lê-se UMA vez, e passa-se à conciliação fiscal. Ver a porta
  // em `conciliacaoFiscal`.
  const relatorios = await loadReports(clientId, de, ate);

  const [
    porConferir, naoIntegrados, fiscal, cPagar, cReceber, banco, anterior,
  ] = await Promise.all([
    contarPorConferir(clientId, de, ate),
    documentosNaoIntegrados(clientId),
    conciliacaoFiscal(clientId, de, ate, relatorios),
    conciliarControlo(clientId, "payable"),
    conciliarControlo(clientId, "receivable"),
    contarContasPorFechar(clientId, ate),
    mesAnteriorPorFechar(clientId, de),
  ]);

  /*
   * As meias-integrações contam-se DENTRO do período.
   *
   * A tela de não integrados mostra tudo; aqui só interessa o que cai neste
   * mês. Uma meia-integração de janeiro não impede fechar março — impede
   * fechar janeiro, que é onde ela tem de ser corrigida.
   */
  const meias = naoIntegrados.itens.filter(
    (i) => i.meiaIntegracao && i.data && i.data >= de && i.data <= ate
  ).length;

  return [
    verificacao("porConferir", porConferir),
    verificacao("meiasIntegracoes", meias),
    verificacao("razaoDesbalanceado", relatorios.balances ? 0 : r2(relatorios.difference)),
    verificacao("vatDivergente", r2(fiscal.vat.diferencaTotal)),
    verificacao("controloPagar", r2(cPagar.difference), cPagar.accounts),
    verificacao("controloReceber", r2(cReceber.difference), cReceber.accounts),
    verificacao("bancoPorFechar", banco),
    verificacao("mesAnteriorAberto", anterior),
  ];
}

/** Documentos do período que ninguém conferiu — o número ainda vai mudar. */
async function contarPorConferir(clientId: string, de: string, ate: string): Promise<number> {
  const [compras, vendas] = await Promise.all([
    sb().from("invoices").select("id", { count: "exact", head: true })
      .eq("client_id", clientId).is("reviewed_at", null)
      .gte("invoice_date", de).lte("invoice_date", ate),
    sb().from("sales").select("id", { count: "exact", head: true })
      .eq("client_id", clientId).is("reviewed_at", null)
      .gte("entry_date", de).lte("entry_date", ate),
  ]);
  return (compras.count ?? 0) + (vendas.count ?? 0);
}

/**
 * Contas bancárias cujo extrato ainda não foi fechado até ao fim do mês.
 *
 * Não impede: o extrato por conciliar não muda o razão. Mas fechar os livros
 * de um mês cujo banco ninguém bateu é fechar sem saber, e é a informação que
 * alguém vai querer quando a diferença aparecer no mês seguinte.
 */
async function contarContasPorFechar(clientId: string, ate: string): Promise<number> {
  const [{ data: contas }, { data: fechos }] = await Promise.all([
    sb().from("bank_accounts").select("id").eq("client_id", clientId),
    sb().from("bank_closings").select("bank_account_id,period_end")
      .eq("client_id", clientId).gte("period_end", ate).eq("locked", true),
  ]);
  const fechadas = new Set(((fechos ?? []) as any[]).map((f) => f.bank_account_id));
  return ((contas ?? []) as any[]).filter((c) => !fechadas.has(c.id)).length;
}

/**
 * O mês anterior tem movimento e não está fechado?
 *
 * Fechar abril deixando março aberto faz do cadeado uma peneira: qualquer
 * correção em março muda os saldos de abertura de abril, que está fechado, e o
 * mês fechado passa a mostrar outro número sem que ninguém lhe tenha tocado.
 */
async function mesAnteriorPorFechar(clientId: string, de: string): Promise<number> {
  const anterior = new Date(`${de}T00:00:00Z`);
  anterior.setUTCDate(0); // o último dia do mês anterior
  const fim = anterior.toISOString().slice(0, 10);

  const inicio = `${fim.slice(0, 7)}-01`;

  // O recorte é o mês anterior, e não "tudo o que veio antes": um mês sem
  // movimento nenhum não tem nada para trancar, e avisar sobre ele seria um
  // aviso que não se pode resolver — o pior tipo, porque ensina a ignorar.
  const { count } = await sb().from("journal").select("id", { count: "exact", head: true })
    .eq("client_id", clientId).gte("posting_date", inicio).lte("posting_date", fim);
  if (!count) return 0;

  const fechados = paraPuro(await periodosFechados(clientId));
  return fechados.some((p) => p.periodStart <= inicio && p.periodEnd >= fim) ? 0 : 1;
}

// ------------------------------------------------------------------ o estado

export type EstadoDoFechamento = {
  de: string; ate: string;
  verificacoes: Verificacao[];
  pode: boolean;
  /** Este mês já está fechado? Então mostra-se o fecho, e não a lista. */
  fechado: PeriodoGravado | null;
  fechadoAte: string | null;
  periodos: PeriodoGravado[];
};

export async function estadoDoFechamento(
  clientId: string, de: string, ate: string
): Promise<EstadoDoFechamento> {
  const periodos = await periodosFechados(clientId);
  const fechado = periodos.find((p) => p.periodStart <= de && p.periodEnd >= ate) ?? null;

  /*
   * Um mês já fechado não se volta a medir.
   *
   * As medições leem o estado de HOJE, e o de hoje pode ter mudado por causa
   * de outro mês. Mostrá-las sobre um mês fechado daria a impressão de que o
   * fecho tem um problema novo — quando o que ficou registado, e o que
   * interessa, é o que se sabia no dia em que se fechou.
   */
  const verificacoes = fechado
    ? (fechado.checks ?? [])
    : await verificacoesDoPeriodo(clientId, de, ate);

  return {
    de, ate, verificacoes,
    pode: !fechado && podeFechar(verificacoes),
    fechado,
    fechadoAte: fechadoAte(paraPuro(periodos)),
    periodos,
  };
}

// ------------------------------------------------------------ fechar/reabrir

export async function fecharPeriodo(args: {
  clientId: string; de: string; ate: string; note?: string | null; userId?: string | null;
}): Promise<{ ok: boolean; id?: string; erro?: string; impedimentos?: Verificacao[] }> {
  const meses = mesesEntre(args.de, args.ate);
  if (!meses.length) return { ok: false, erro: "Período inválido." };

  /*
   * As verificações são REFEITAS aqui, e não recebidas da tela.
   *
   * A tela mostrou-as há minutos; entretanto alguém pode ter lançado uma nota
   * no período. Aceitar o veredito do ecrã seria fechar sobre o que era
   * verdade quando a página carregou.
   */
  const verificacoes = await verificacoesDoPeriodo(args.clientId, args.de, args.ate);
  const barram = impedimentos(verificacoes);
  if (barram.length) {
    return { ok: false, erro: "Há pendências que impedem o fecho deste período.", impedimentos: barram };
  }

  const { data, error } = await sb().from("accounting_periods").insert({
    client_id: args.clientId,
    period_start: args.de, period_end: args.ate,
    closed_by: args.userId ?? null,
    note: args.note?.trim() || null,
    // A fotografia do que se sabia. Ver o comentário da coluna em 039.
    checks: verificacoes,
  }).select("id").single();

  if (error) {
    const duplicado = /duplicate key|already exists/i.test(error.message);
    return { ok: false, erro: duplicado ? "Este período já está fechado." : error.message };
  }
  return { ok: true, id: (data as any).id };
}

/**
 * Reabrir — com motivo, e sem apagar o histórico.
 *
 * O motivo é obrigatório porque reabrir um período fechado é desfazer uma
 * afirmação que já pode ter saído em papel. Quem o faz sabe porquê; quem
 * pergunta seis meses depois não sabe, e é para esse que o campo existe.
 */
export async function reabrirPeriodo(args: {
  clientId: string; id: string; motivo: string; userId?: string | null;
}): Promise<{ ok: boolean; erro?: string }> {
  if (!args.motivo?.trim()) {
    return { ok: false, erro: "Diga porque está a reabrir — fica no registo do fecho." };
  }
  const { error, count } = await sb().from("accounting_periods")
    .update({
      reopened_at: new Date().toISOString(),
      reopened_by: args.userId ?? null,
      reopen_reason: args.motivo.trim(),
    }, { count: "exact" })
    .eq("id", args.id).eq("client_id", args.clientId).is("reopened_at", null);

  if (error) return { ok: false, erro: error.message };
  if (!count) return { ok: false, erro: "Esse fecho não existe ou já foi reaberto." };
  return { ok: true };
}
