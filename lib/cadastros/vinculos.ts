/**
 * QUEM APONTA PARA ESTE CADASTRO — a contagem, separada da decisão.
 *
 * A política vive em ./travaDeExclusao.ts e não sabe nada de base de dados.
 * Aqui é o contrário: só se conta, e devolve-se a contagem para ela decidir.
 *
 * ---------------------------------------------------------------------------
 * O QUE SE CONTA, E PORQUE NÃO SE CONTA TUDO
 *
 * Um cliente tem 32 tabelas a apontar-lhe. Contá-las todas faria QUALQUER
 * cliente parecer intocável — as obrigações fiscais, por exemplo, nascem
 * sozinhas no dia em que o cliente é criado, e um cliente registado por engano
 * há dois minutos já teria seis. A trava passaria a acumular lixo, e alguém
 * acabaria por a contornar pelo banco. É assim que uma regra morre.
 *
 * Então conta-se o que uma PESSOA lançou, ou o que já é contabilidade feita:
 * documentos, lançamentos no razão, títulos, movimentos de banco, funcionários,
 * recibos de vencimento e meses fechados. O que é derivado (obrigações,
 * mapeamentos, sequências) desaparece com o cadastro sem perda nenhuma, porque
 * volta a nascer.
 *
 * ---------------------------------------------------------------------------
 * PORQUE A CONTAGEM É UMA CONSULTA POR TABELA, E NÃO UM `join`
 *
 * São contagens `head: true` — o servidor devolve o número, não as linhas. Meia
 * dúzia delas em paralelo custa menos do que um `join` sobre tabelas grandes, e
 * lê-se. A alternativa "esperta" seria uma função no banco; seria mais rápida e
 * viveria longe da regra que a usa.
 */

import { getServerSupabase } from "@/lib/supabase";
import { decidirExclusao, type Veredito, type Vinculo } from "./travaDeExclusao";

const sb = () => getServerSupabase();

/** Uma tabela que aponta para o cadastro, e como se chama para quem lê. */
interface Fonte {
  tabela: string;
  coluna: string;
  chave: string;
}

/**
 * O QUE CONTA COMO MOVIMENTO, por tipo de cadastro.
 *
 * Esta tabela é a definição da regra em dados. Acrescentar um módulo novo ao
 * produto é acrescentar uma linha aqui — e esquecer-se dela é a única maneira
 * de a trava ficar com um buraco, por isso ela vive num sítio só e à vista.
 */
const FONTES: Record<string, Fonte[]> = {
  cliente: [
    { tabela: "invoices", coluna: "client_id", chave: "vinc.compras" },
    { tabela: "sales", coluna: "client_id", chave: "vinc.vendas" },
    { tabela: "journal", coluna: "client_id", chave: "vinc.razao" },
    { tabela: "ledger_items", coluna: "client_id", chave: "vinc.titulos" },
    { tabela: "bank_transactions", coluna: "client_id", chave: "vinc.banco" },
    { tabela: "hr_employees", coluna: "client_id", chave: "vinc.funcionarios" },
    { tabela: "hr_payslip", coluna: "client_id", chave: "vinc.recibos" },
    { tabela: "accounting_periods", coluna: "client_id", chave: "vinc.mesesFechados" },
  ],
  funcionario: [
    { tabela: "hr_employee_hours", coluna: "employee_id", chave: "vinc.horas" },
    { tabela: "hr_payslip", coluna: "employee_id", chave: "vinc.recibos" },
    { tabela: "hr_psr_line", coluna: "employee_id", chave: "vinc.psr" },
  ],
  contaBancaria: [
    { tabela: "bank_transactions", coluna: "bank_account_id", chave: "vinc.banco" },
    { tabela: "bank_imports", coluna: "bank_account_id", chave: "vinc.importacoes" },
    { tabela: "bank_closings", coluna: "bank_account_id", chave: "vinc.fechosBanco" },
  ],
  filial: [
    { tabela: "invoices", coluna: "branch_id", chave: "vinc.compras" },
    { tabela: "sales", coluna: "branch_id", chave: "vinc.vendas" },
  ],
  clienteFinal: [
    { tabela: "issued_invoices", coluna: "customer_id", chave: "vinc.faturasEmitidas" },
  ],
  contaDoPlano: [
    // A partida é a LINHA do lançamento (`journal_lines`), não o lançamento.
    { tabela: "journal_lines", coluna: "account_code", chave: "vinc.partidas" },
  ],
  utilizador: [
    { tabela: "journal", coluna: "created_by", chave: "vinc.razao" },
    { tabela: "ledger_settlements", coluna: "created_by", chave: "vinc.baixas" },
    { tabela: "bank_transactions", coluna: "created_by", chave: "vinc.banco" },
    { tabela: "bank_imports", coluna: "imported_by", chave: "vinc.importacoes" },
  ],
};

export type TipoDeCadastro = keyof typeof FONTES;

/**
 * Conta o que aponta para este cadastro e devolve o veredito.
 *
 * Uma tabela que não existe nesta instalação (migração por correr, módulo
 * desligado) conta ZERO em vez de rebentar. A alternativa seria uma exclusão
 * bloqueada por um erro que ninguém percebe — e o objectivo da trava é
 * explicar, não apenas impedir.
 */
export async function vinculosDe(
  tipo: TipoDeCadastro,
  id: string,
  /*
   * Um segundo filtro, para quando o `id` não é único no produto todo.
   *
   * A conta do plano é o caso: `journal_lines` guarda o CÓDIGO da conta
   * ("6200"), e o mesmo código existe em todos os clientes. Sem o recorte, a
   * conta 6200 do cliente A pareceria em uso por causa do razão do cliente B —
   * e a trava, em vez de proteger, passaria a mentir.
   */
  escopo?: { coluna: string; valor: string }
): Promise<Veredito> {
  const fontes = FONTES[tipo];
  if (!fontes) return { pode: true };

  const contagens = await Promise.all(
    fontes.map(async (f): Promise<Vinculo> => {
      let q = sb().from(f.tabela).select("id", { count: "exact", head: true }).eq(f.coluna, id);
      if (escopo) q = q.eq(escopo.coluna, escopo.valor);
      const { count, error } = await q;
      return { chave: f.chave, quantidade: error ? 0 : count ?? 0 };
    })
  );

  return decidirExclusao(contagens);
}

/**
 * O erro que o servidor devolve quando a trava morde.
 *
 * `409 Conflict` e não `403`: não é falta de permissão — é o estado do próprio
 * cadastro que impede. É o mesmo código, e a mesma forma, que a recusa de
 * apagar um documento já contabilizado, que já existe no produto e cuja
 * mensagem o teste de ponta a ponta elogiou. Duas recusas parecidas devem
 * parecer-se.
 */
export function corpoDoImpedimento(v: Veredito) {
  if (v.pode) return null;
  return {
    error: "temMovimento",
    total: v.total,
    vinculos: v.vinculos,
  };
}
