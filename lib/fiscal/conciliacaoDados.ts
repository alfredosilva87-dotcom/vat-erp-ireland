import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { inputVatInPeriod, salesVatInPeriod } from "@/lib/store";
import { CONTAS_PADRAO } from "@/lib/accounting/post";
import { loadReports } from "@/lib/accounting/query";
import { conciliarVat, conciliarImposto, type ConciliacaoDeVat, type ConciliacaoDeImposto } from "./conciliacao";

/**
 * Os dois lados da conciliação fiscal, buscados no banco.
 *
 * A aritmética está em `conciliacao.ts`, que é pura e testada. Aqui só se
 * juntam os números — e a decisão que importa é DE ONDE eles saem.
 */

const PAGINA = 1000;
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * O MOVIMENTO de um conjunto de contas no período — não o saldo.
 *
 * O saldo arrasta o que veio de períodos anteriores, e uma declaração é só do
 * seu período: comparar saldo com o apurado do período daria uma diferença que
 * existe e não é erro nenhum, todos os meses.
 *
 * Devolve débito e crédito separados porque o lado importa: o IVA das vendas
 * entra a CRÉDITO na conta de controlo e o das compras a DÉBITO na de
 * recuperação. Somar os dois num líquido perderia a distinção justamente onde
 * ela é a resposta.
 */
async function movimentoNoPeriodo(
  clientId: string, contas: string[], de: string, ate: string
): Promise<{ debito: number; credito: number }> {
  const sb = getServerSupabase();
  let debito = 0, credito = 0;

  for (let inicio = 0; ; inicio += PAGINA) {
    const { data } = await sb.from("journal_lines")
      .select("debit,credit,account_code,journal!inner(client_id,posting_date)")
      .eq("journal.client_id", clientId)
      .gte("journal.posting_date", de)
      .lte("journal.posting_date", ate)
      .in("account_code", contas)
      .range(inicio, inicio + PAGINA - 1);

    const lote = (data ?? []) as any[];
    for (const l of lote) {
      debito += Number(l.debit) || 0;
      credito += Number(l.credit) || 0;
    }
    // O PostgREST corta em 1000 linhas sem avisar — e num cliente com movimento
    // a sério a conta de IVA passa disso no primeiro ano.
    if (lote.length < PAGINA) break;
  }
  return { debito: r2(debito), credito: r2(credito) };
}

export type ConciliacaoFiscal = {
  de: string;
  ate: string;
  cliente: { name: string; client_code: string | null; vat_number: string | null; legal_form: string | null };
  vat: ConciliacaoDeVat;
  imposto: ConciliacaoDeImposto;
};

export async function conciliacaoFiscal(
  clientId: string, de: string, ate: string
): Promise<ConciliacaoFiscal> {
  const sb = getServerSupabase();

  const [{ data: cliente }, docEntradas, docSaidas, relatorios] = await Promise.all([
    sb.from("clients").select("name,client_code,vat_number,legal_form").eq("id", clientId).maybeSingle(),
    // As MESMAS funções que alimentam o VAT3 — ver o comentário em store.ts.
    inputVatInPeriod(clientId, de, ate),
    salesVatInPeriod(clientId, de, ate),
    loadReports(clientId, de, ate),
  ]);

  const [movSaidas, movEntradas, movImpostoDespesa, movImpostoPassivo] = await Promise.all([
    movimentoNoPeriodo(clientId, [CONTAS_PADRAO.vatPayable], de, ate),
    movimentoNoPeriodo(clientId, [CONTAS_PADRAO.vatReceivable], de, ate),
    movimentoNoPeriodo(clientId, [CONTA_DESPESA_IMPOSTO], de, ate),
    movimentoNoPeriodo(clientId, [CONTA_PASSIVO_IMPOSTO], de, ate),
  ]);

  const vat = conciliarVat({
    de, ate,
    docSaidas, docEntradas,
    // O IVA das vendas nasce a CRÉDITO; o das compras, a DÉBITO. Trocar isto
    // daria uma divergência do dobro do valor, em vez de zero.
    razaoSaidas: r2(movSaidas.credito - movSaidas.debito),
    razaoEntradas: r2(movEntradas.debito - movEntradas.credito),
    contaSaidas: CONTAS_PADRAO.vatPayable,
    contaEntradas: CONTAS_PADRAO.vatReceivable,
  });

  /*
   * O lucro ANTES de imposto sai do próprio DRE.
   *
   * `profitBeforeTax` é a linha que o relatório já calcula, e usá-la é o que
   * garante que este quadro e a demonstração dizem o mesmo. Recalcular aqui a
   * partir dos saldos daria dois lucros no mesmo sistema.
   */
  const linhaDoLucro = (relatorios.profitAndLoss ?? [])
    .find((l) => l.key === "profit_before_tax");
  /*
   * Sem a linha, REBENTA — não devolve zero.
   *
   * Escrevi `incomeStatement` à primeira, e a chave chama-se `profitAndLoss`:
   * o `?? 0` engoliu o engano e o quadro teria mostrado lucro zero, taxa
   * efetiva nula e uma divergência do tamanho do imposto inteiro. Um número
   * errado com ar de verdade é o pior resultado possível num ecrã de
   * conferência — pior do que não abrir.
   */
  if (!linhaDoLucro) {
    throw new Error("A demonstração de resultados não trouxe a linha 'profit_before_tax'.");
  }
  const lucroAntes = r2(linhaDoLucro.amount);

  const imposto = conciliarImposto({
    de, ate,
    // Um empresário em nome individual não paga corporation tax: o lucro dele é
    // tributado na pessoa, pela Form 11. Ver lib/fiscal/formaJuridica.ts.
    aplicavel: (cliente as any)?.legal_form === "limited_company",
    lucroAntesDeImposto: lucroAntes,
    despesaDeImposto: r2(movImpostoDespesa.debito - movImpostoDespesa.credito),
    movimentoDoPassivo: r2(movImpostoPassivo.credito - movImpostoPassivo.debito),
    contaDespesa: CONTA_DESPESA_IMPOSTO,
    contaPassivo: CONTA_PASSIVO_IMPOSTO,
  });

  return {
    de, ate,
    cliente: {
      name: (cliente as any)?.name ?? "",
      client_code: (cliente as any)?.client_code ?? null,
      vat_number: (cliente as any)?.vat_number ?? null,
      legal_form: (cliente as any)?.legal_form ?? null,
    },
    vat, imposto,
  };
}

/*
 * As contas do imposto sobre o lucro.
 *
 * Não estão em `CONTAS_PADRAO` porque o motor nunca lança nelas sozinho — o
 * imposto é um lançamento de fecho, feito à mão. Ficam aqui, ao lado de quem
 * as lê, e com o código do plano da prática (migração 037).
 */
const CONTA_DESPESA_IMPOSTO = "501";   // Corporation tax current year
const CONTA_PASSIVO_IMPOSTO = "831";   // Corporation tax payable
