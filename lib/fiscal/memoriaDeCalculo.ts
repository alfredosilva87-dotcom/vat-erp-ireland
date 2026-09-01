/**
 * A MEMÓRIA DE CÁLCULO DO IMPOSTO — do lucro até ao que se paga.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO É UMA TELA E NÃO UMA CONTA DE CABEÇA
 *
 * Pedido do Alfredo: "precisa ter o cálculo abaixo das contas contábeis, pra
 * ficar fácil, aplicando a alíquota etc, começando do lucro".
 *
 * O painel já dizia o lucro e já dizia o imposto lançado. O que não dizia era
 * **como se vai de um ao outro** — e é exactamente esse passo que o cliente
 * pergunta quando recebe a conta, e o que o contabilista tem de reproduzir se
 * a Revenue perguntar. Um número final sem os degraus é um número que se
 * acredita ou não se acredita; com os degraus, discute-se.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE MÓDULO NÃO SABE, E DIZ QUE NÃO SABE
 *
 * Duas coisas decidem o imposto irlandês e NÃO estão na contabilidade:
 *
 *   - que despesas são não dedutíveis (representação, multas, parte de alguns
 *     encargos) — o plano de contas não as marca;
 *   - que parte do lucro é RENDIMENTO PASSIVO (renda, juros, dividendos), que
 *     paga 25% em vez dos 12,5% do lucro de exploração.
 *
 * Podia adivinhar as duas pelo nome das contas. Não adivinho: um imposto
 * calculado com um palpite parece tão certo como um calculado à mão, e ninguém
 * saberia qual dos dois estava a olhar. Entram como valores que alguém escreve,
 * começam a zero, e a memória mostra a linha mesmo quando é zero — para se ver
 * que a pergunta foi feita.
 * ---------------------------------------------------------------------------
 *
 * Puro: entra o lucro e os ajustes, saem os degraus. É por isso que cada regra
 * se testa com a lei na mão.
 */

/** As duas taxas irlandesas. Ver `conciliacao.ts`, que as declara. */
export const TAXA_EXPLORACAO = 12.5;
export const TAXA_PASSIVO = 25;

export type TipoDeLinha = "base" | "ajuste" | "subtotal" | "taxa" | "total";

export type LinhaDaMemoria = {
  /** A chave; o texto sai do dicionário na tela. Ver `conciliacao.ts`. */
  chave:
    | "lucroContabil" | "naoDedutivel" | "naoTributavel" | "lucroTributavel"
    | "baseExploracao" | "basePassivo" | "impostoDoExercicio"
    | "jaReconhecido" | "porReconhecer";
  tipo: TipoDeLinha;
  valor: number;
  /** Só nas linhas de aplicação: a alíquota, e a base sobre que incide. */
  taxa?: number;
  base?: number;
};

export type Memoria = {
  linhas: LinhaDaMemoria[];
  /** O imposto do exercício, antes de descontar o já reconhecido. */
  imposto: number;
  /** Imposto ÷ lucro contábil. Nulo quando não há lucro — não se divide por zero. */
  taxaEfetiva: number | null;
  /** O que falta reconhecer na contabilidade. Negativo = reconheceu-se a mais. */
  porReconhecer: number;
  /** Houve prejuízo: não há imposto, e a tela tem de o dizer em vez de mostrar 0. */
  prejuizo: boolean;
};

export type PedidoDaMemoria = {
  lucroAntesDeImposto: number;
  /** Despesas que a contabilidade deduziu e a lei não deduz. Somam à base. */
  naoDedutivel?: number;
  /** Rendimentos contabilizados que não são tributáveis. Abatem da base. */
  naoTributavel?: number;
  /** Parte do lucro tributável que é rendimento passivo, à taxa de 25%. */
  rendimentoPassivo?: number;
  /** O que já está lançado como despesa de imposto no resultado. */
  jaReconhecido?: number;
};

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

export function memoriaDeCT(p: PedidoDaMemoria): Memoria {
  const lucro = r2(p.lucroAntesDeImposto);
  const naoDedutivel = r2(p.naoDedutivel);
  const naoTributavel = r2(p.naoTributavel);
  const jaReconhecido = r2(p.jaReconhecido);

  const tributavel = r2(lucro + naoDedutivel - naoTributavel);

  /*
   * O PREJUÍZO NÃO GERA IMPOSTO NEGATIVO.
   *
   * Sem esta trava, um lucro tributável de -4.000 daria -500 de imposto, e
   * -500 numa memória de cálculo lê-se como reembolso — que não é o que
   * acontece: o prejuízo reporta-se para os anos seguintes, e isso é outra
   * conta, que este quadro não faz.
   */
  const prejuizo = tributavel <= 0;

  /*
   * O rendimento passivo sai de DENTRO do lucro tributável, não de fora.
   *
   * Pô-lo a somar daria imposto sobre uma base maior do que o próprio lucro.
   * E não pode ser maior do que ele: quem escrever 20.000 de renda num lucro
   * de 11.000 fica com os 11.000 todos à taxa de 25%, que é o mais próximo da
   * verdade que este quadro consegue.
   */
  const passivo = prejuizo ? 0 : Math.min(Math.max(0, r2(p.rendimentoPassivo)), tributavel);
  const exploracao = prejuizo ? 0 : r2(tributavel - passivo);

  const impostoExploracao = r2((exploracao * TAXA_EXPLORACAO) / 100);
  const impostoPassivo = r2((passivo * TAXA_PASSIVO) / 100);
  const imposto = r2(impostoExploracao + impostoPassivo);

  const linhas: LinhaDaMemoria[] = [
    { chave: "lucroContabil", tipo: "base", valor: lucro },
    { chave: "naoDedutivel", tipo: "ajuste", valor: naoDedutivel },
    { chave: "naoTributavel", tipo: "ajuste", valor: -naoTributavel },
    { chave: "lucroTributavel", tipo: "subtotal", valor: tributavel },
    { chave: "baseExploracao", tipo: "taxa", valor: impostoExploracao, taxa: TAXA_EXPLORACAO, base: exploracao },
    { chave: "basePassivo", tipo: "taxa", valor: impostoPassivo, taxa: TAXA_PASSIVO, base: passivo },
    { chave: "impostoDoExercicio", tipo: "total", valor: imposto },
    { chave: "jaReconhecido", tipo: "ajuste", valor: -jaReconhecido },
    { chave: "porReconhecer", tipo: "total", valor: r2(imposto - jaReconhecido) },
  ];

  return {
    linhas,
    imposto,
    // A taxa efetiva compara-se com o LUCRO CONTÁBIL, que é o que o cliente vê
    // no DRE — e não com a base tributável, que ele não conhece.
    taxaEfetiva: lucro > 0 ? Math.round((imposto / lucro) * 1000) / 10 : null,
    porReconhecer: r2(imposto - jaReconhecido),
    prejuizo,
  };
}
