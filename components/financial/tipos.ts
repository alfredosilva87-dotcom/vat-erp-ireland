/**
 * Os tipos e os formatadores partilhados pela lista de títulos e pelo painel.
 *
 * Ficheiro próprio porque os dois precisam exatamente das mesmas formas, e
 * declará-las duas vezes é como duas telas passam a discordar sobre o que é um
 * título — sem ninguém reparar até um campo novo aparecer só de um lado.
 */

export type Titulo = {
  id: string; kind: string; document_ref: string | null; counterparty: string | null;
  issue_date: string | null; due_date: string | null; account_code: string | null;
  original_amount: number; charges_amount: number; settled_amount: number;
  outstanding_amount: number; status: string; notes: string | null;
  source_module: string; journal_id: string | null;
};

export type Encargo = {
  id: string; kind: string; amount: number; account_code: string | null;
  description: string | null; incurred_on: string;
};

export type Baixa = {
  id: string; settled_on: string; amount: number;
  bank_transaction_id: string | null; journal_id: string | null;
};

export type ContaBanco = {
  id: string; name: string; bank_name: string | null; account_code: string | null;
};

/** Uma partida do razão produzida por este título. */
export type Partida = {
  id: string; journalId: string; accountCode: string; accountName: string;
  debit: number; credit: number; date: string | null; origin: string | null;
  description: string | null;
};

/**
 * Os encargos que se podem lançar num título, e a conta que cada um sugere.
 *
 * A conta é sugestão e não regra: quem lança pode trocar. Mas partir de uma
 * conta plausível é o que faz o juro cair em 7100 em vez de "outras despesas"
 * na esmagadora maioria das vezes, que é onde ele seria impossível de somar
 * no fim do ano.
 */
/*
 * Os tipos de encargo. `r` deixou de ser o rótulo e passou a ser a CHAVE do
 * dicionário: o rótulo em português vivia aqui, então o painel do título
 * mostrava "Juros" mesmo com o sistema em inglês.
 */
export const ENCARGOS: { v: string; r: string; conta: string }[] = [
  { v: "interest", r: "chg.interest", conta: "7100" },
  { v: "fee", r: "chg.fee", conta: "6990" },
  { v: "penalty", r: "chg.penalty", conta: "6990" },
  { v: "other", r: "chg.other", conta: "6990" },
  { v: "discount", r: "chg.discount", conta: "4900" },
];

/** De onde veio a partida — chave do dicionário, ver ENCARGOS. */
export const ORIGEM: Record<string, string> = {
  purchase: "src.purchase", sale: "src.sale", bank: "src.bank",
  charge: "src.charge", payroll: "src.payroll", manual: "src.manual",
  opening: "src.opening",
};

export const eur = (v: number) =>
  (Number(v) || 0).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
