/**
 * CADASTRO COM MOVIMENTO NÃO SE APAGA — DESACTIVA-SE.
 *
 * ---------------------------------------------------------------------------
 * A REGRA, E DE ONDE ELA VEIO
 *
 * Um cliente, um fornecedor, uma conta, um funcionário: assim que tiver um
 * documento ou um lançamento ligado a si, deixa de poder ser apagado. Pode ser
 * editado, e pode ser **desactivado** — deixa de aparecer para trabalho novo,
 * e continua a explicar o que já aconteceu.
 *
 * A alternativa que existia era pior de duas maneiras ao mesmo tempo:
 *
 *   - Onde a chave estrangeira dizia `on delete set null`, apagar o cadastro
 *     deixava as linhas **sem dono**. Foi medido: apagar um cliente anunciava,
 *     na própria confirmação, que as faturas dele "ficam na base de dados mas
 *     passam a não ter cliente" — e nenhum filtro do produto as mostrava
 *     depois, porque todos os filtros eram por cliente. A promessa era
 *     verdadeira e inútil.
 *   - Onde a chave dizia `no action`, o apagar rebentava com um erro de base de
 *     dados em bruto, que não diz a ninguém o que fazer a seguir.
 *
 * Um exemplo real desta instalação, encontrado ao limpar uma conta de teste:
 * apagá-la teria falhado no razão (106 lançamentos, `no action`) **depois** de
 * já ter posto 47 movimentos de banco sem autor (`set null`). Metade do estrago
 * feito, e um erro no fim.
 *
 * ---------------------------------------------------------------------------
 * PORQUE A DECISÃO É PURA, E A CONTAGEM NÃO
 *
 * Contar quem aponta para um cadastro é trabalho de base de dados e muda com o
 * esquema. Decidir o que fazer com essa contagem é política, e tem de ser igual
 * em todo o produto — no cliente, no funcionário, na conta bancária. Separadas,
 * a política lê-se de uma vez e testa-se sem banco.
 *
 * ---------------------------------------------------------------------------
 * O QUE ISTO NÃO FAZ
 *
 * Não impede apagar um cadastro **limpo**. Um cliente criado por engano há dois
 * minutos, sem nada ligado, apaga-se — e deve. A trava existe para proteger
 * histórico, não para acumular lixo.
 */

/** Uma coisa que aponta para este cadastro. */
export interface Vinculo {
  /**
   * Como se chama isto na língua de quem lê — chave de tradução, não frase.
   * Ver o comentário em lib/fiscal/identificadores.ts sobre porquê.
   */
  chave: string;
  quantidade: number;
}

export type Veredito =
  /** Nada aponta para este cadastro: pode sair. */
  | { pode: true }
  /** Tem histórico. A saída é desactivar. */
  | { pode: false; vinculos: Vinculo[]; total: number };

/**
 * Decide, e só decide.
 *
 * Os vínculos a zero são deitados fora aqui e não por quem conta: quem conta
 * pergunta sempre por todas as tabelas (é uma consulta só), e uma lista com
 * "0 faturas" lá dentro obrigaria cada ecrã a filtrar outra vez.
 */
export function decidirExclusao(vinculos: Vinculo[]): Veredito {
  const comAlgo = vinculos.filter((v) => v.quantidade > 0);
  if (!comAlgo.length) return { pode: true };
  return {
    pode: false,
    // Do mais numeroso para o menos: é a ordem em que a informação é útil.
    vinculos: [...comAlgo].sort((a, b) => b.quantidade - a.quantidade),
    total: comAlgo.reduce((s, v) => s + v.quantidade, 0),
  };
}

/**
 * O resumo curto que vai no erro do servidor e no ecrã.
 *
 * Devolve as peças, não a frase: quem mostra junta-as na sua língua. Limita a
 * três vínculos porque uma mensagem com onze linhas deixa de ser lida, e os
 * três maiores já dizem o tamanho do problema.
 */
export function resumoDoImpedimento(v: Veredito, maximo = 3): {
  total: number;
  principais: Vinculo[];
  restantes: number;
} | null {
  if (v.pode) return null;
  const principais = v.vinculos.slice(0, maximo);
  return {
    total: v.total,
    principais,
    restantes: Math.max(0, v.vinculos.length - principais.length),
  };
}

/**
 * A pergunta do outro lado: este cadastro pode ser ESCOLHIDO para trabalho novo?
 *
 * Um cadastro desactivado continua a existir e continua a aparecer no histórico
 * — mas escolhê-lo para um lançamento novo é quase sempre engano, e é o engano
 * que a desactivação existe para evitar. Quem já o tinha escolhido antes de ser
 * desactivado não é expulso do meio do trabalho: `jaEscolhido` deixa passar,
 * com aviso.
 */
export function podeSerEscolhido(
  cadastro: { activo: boolean },
  jaEscolhido = false
): { ok: true } | { ok: false; aviso: "desactivado" } | { ok: true; aviso: "desactivado" } {
  if (cadastro.activo) return { ok: true };
  if (jaEscolhido) return { ok: true, aviso: "desactivado" };
  return { ok: false, aviso: "desactivado" };
}
