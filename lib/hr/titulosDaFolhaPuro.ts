import { createHash } from "crypto";
import { monthOfWeek } from "./payroll";

/**
 * A folha fechada vira DOIS títulos a pagar — e as contas que decidem quais.
 *
 * ---------------------------------------------------------------------------
 * POR QUE DOIS, E NÃO UM PELO BRUTO
 *
 * O título antigo (`lib/financial/payrollTitles.ts`) era um só, pelo BRUTO. Do
 * banco, porém, saem dois pagamentos, em datas diferentes e para gente
 * diferente:
 *
 *   · o LÍQUIDO, para os trabalhadores, na data de pagamento da folha;
 *   · PAYE + USC + PRSI (do trabalhador E do empregador), para a Revenue, até
 *     ao dia 14 do mês seguinte.
 *
 * Um título de bruto não casa com nenhum dos dois: é maior do que a
 * transferência dos salários e menor do que a soma das duas. Na conciliação
 * ficava sempre por fechar, mês após mês — que é exactamente o problema que o
 * título tinha vindo resolver.
 *
 * ---------------------------------------------------------------------------
 * A CHAVE DE IDEMPOTÊNCIA É UM UUID DERIVADO DO PERÍODO
 *
 * `ledger_items` já tem um índice único em `(client_id, document_id)` — ver a
 * migração 041. Ou seja: o banco já sabe recusar dois títulos com o mesmo
 * documento, e essa é a garantia que não depende de ninguém se lembrar de
 * procurar antes de escrever.
 *
 * Só que o par (líquido, imposto) precisa de DUAS chaves, e a folha moderna não
 * tem linha nenhuma no banco que sirva de documento — os payslips são um por
 * pessoa, e o período não tem linha própria. Em vez de inventar uma tabela só
 * para ter um id, deriva-se o id: um UUID v5 sobre
 * `cliente:ano:frequência:período:tipo`.
 *
 * A mesma folha fechada duas vezes calcula o MESMO uuid, e o segundo INSERT
 * bate no índice em vez de criar um título gémeo. `document_id` não tem chave
 * estrangeira nenhuma em `ledger_items` (ver migração 020), por isso um id
 * derivado é tão válido ali como o id de uma linha real.
 * ---------------------------------------------------------------------------
 *
 * Puro de propósito: é isto que os testes fixam. A parte que fala com o banco
 * vive em `lib/financial/payrollTitles.ts`.
 */

export type FreqDaFolha = "weekly" | "fortnightly" | "monthly";
export type TipoDeTituloDaFolha = "liquido" | "imposto";

/**
 * O namespace do UUID v5. Constante, e nunca mais muda.
 *
 * Mudá-la faria todos os títulos já criados deixarem de ser encontrados pela
 * chave — e a folha seguinte criava um duplicado de tudo o que já existe, sem
 * erro nenhum, porque o índice único não veria colisão.
 */
const NAMESPACE = "0f4f1e2a-6c31-4a7d-9b8e-3d5c2f7a1b04";

function uuidV5(namespace: string, nome: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(Buffer.concat([ns, Buffer.from(nome, "utf8")])).digest();
  const b = Buffer.from(h.subarray(0, 16));
  // Versão 5 e variante RFC 4122. Sem estes dois bytes o valor passa no tipo
  // `uuid` do Postgres à mesma, mas deixa de ser distinguível de um uuid v4
  // aleatório — e quem for depurar não tem como saber que foi derivado.
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const s = b.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export function chaveDoTituloDaFolha(
  clientId: string, year: number, periodNo: number,
  freqType: FreqDaFolha, tipo: TipoDeTituloDaFolha
): string {
  return uuidV5(NAMESPACE, `${clientId}:${year}:${freqType}:${periodNo}:${tipo}`);
}

// --------------------------------------------------------------- referências

/** `S` semana, `Q` quinzena, `M` mês — a letra que aparece na referência. */
const MARCA: Record<string, string> = { weekly: "S", fortnightly: "Q", monthly: "M" };

export function referenciaDoPeriodo(
  year: number, periodNo: number, freqType: FreqDaFolha
): string {
  return `FOLHA ${year}-${MARCA[freqType] ?? "P"}${String(periodNo).padStart(2, "0")}`;
}

/**
 * `FOLHA 2026-M09 LIQ` e `FOLHA 2026-M09 IMP`.
 *
 * O sufixo existe para quem olha a lista de contas a pagar saber, sem abrir
 * nada, qual das duas linhas é a dos salários e qual é a da Revenue. Sem ele
 * eram duas linhas com o mesmo nome e valores diferentes — e a primeira
 * pergunta de quem concilia era "qual destas é qual".
 */
export function referenciaDoTituloDaFolha(
  year: number, periodNo: number, freqType: FreqDaFolha, tipo: TipoDeTituloDaFolha
): string {
  return `${referenciaDoPeriodo(year, periodNo, freqType)} ${tipo === "liquido" ? "LIQ" : "IMP"}`;
}

// ------------------------------------------------------------- vencimentos

/**
 * O imposto da folha vence a 14 do mês SEGUINTE ao pagamento.
 *
 * ---------------------------------------------------------------------------
 * DE ONDE VEM O DIA 14
 *
 * É o prazo do pagamento mensal de PAYE/PRSI/USC na Irlanda: o empregador
 * declara na data do pagamento (a submissão em tempo real) mas PAGA até ao dia
 * 14 do mês a seguir ao mês em que pagou. Quem paga por débito directo ou
 * quem é trimestral tem outra data — e por isso este é o VENCIMENTO, uma
 * previsão, e não um facto comunicado: serve para o título aparecer no sítio
 * certo da lista do que está por pagar. Quem tem outro prazo altera a data no
 * título, como em qualquer outro.
 *
 * Escolheu-se a data de PAGAMENTO da folha e não o fim do período: é o mês em
 * que o dinheiro saiu que manda no prazo. Uma folha da semana 5 paga a 3 de
 * Fevereiro vence a 14 de Março, e não a 14 de Fevereiro.
 * ---------------------------------------------------------------------------
 */
export function vencimentoDoImpostoDaFolha(payDate: string): string {
  const ano = Number(String(payDate).slice(0, 4));
  const mes = Number(String(payDate).slice(5, 7));
  if (!ano || !mes) return String(payDate);
  const a = mes === 12 ? ano + 1 : ano;
  const m = mes === 12 ? 1 : mes + 1;
  return `${a}-${String(m).padStart(2, "0")}-14`;
}

// ------------------------------------------------------------------ valores

export type TotaisDaFolha = {
  /** Tudo em cêntimos inteiros, como vem de `correrFolha`. */
  liquido: number; paye: number; usc: number; prsiEe: number; prsiEr: number;
};

/**
 * Quanto vai em cada título.
 *
 * O imposto leva as QUATRO parcelas — inclusive o PRSI do empregador, que não
 * sai do salário de ninguém mas vai na mesma transferência para a Revenue.
 * Deixá-lo de fora dava um título mais pequeno do que o pagamento, e a
 * conciliação parava outra vez.
 *
 * O PAYE pode vir NEGATIVO quando o cumulativo devolve imposto. Nesse caso o
 * total ainda costuma ser positivo (o PRSI não devolve), mas pode não ser — e
 * um título de valor zero ou negativo não existe: `ledger_items` recusa-o, e
 * com razão. Quem chama trata do caso; aqui só se devolve o número.
 */
export function partirAFolha(t: TotaisDaFolha): { liquidoCents: number; impostoCents: number } {
  return {
    liquidoCents: Math.round(t.liquido),
    impostoCents: Math.round(t.paye + t.usc + t.prsiEe + t.prsiEr),
  };
}

// ------------------------------------------------- a que período dá a semana

/**
 * A semana ISO `semana` cai em que período desta frequência?
 *
 * É o inverso de `semanasDoPeriodo` (em `lib/hr/folha.ts`), e existe por uma
 * razão só: a GUARDA CONTRA DUPLICADO entre os dois caminhos que criam título
 * de folha. O quadro semanal antigo cria pela SEMANA; a folha moderna cria pelo
 * PERÍODO. Para saber se já há título do outro caminho é preciso saber traduzir
 * de um para o outro.
 *
 * A regra do mensal é a mesma do resto do sistema: a semana pertence ao mês da
 * sua quinta-feira.
 */
export function periodoDaSemana(freq: FreqDaFolha, ano: number, semana: number): number {
  if (freq === "weekly") return semana;
  if (freq === "fortnightly") return Math.ceil(semana / 2);
  return monthOfWeek(ano, semana) + 1;
}
