/**
 * O FECHAMENTO DO PERÍODO — a parte que não fala com o banco.
 *
 * ---------------------------------------------------------------------------
 * POR QUE FECHAR PRECISA DE UMA ROTINA, E NÃO DE UM BOTÃO
 *
 * Fechar um mês é uma afirmação forte: "o que está aqui é o que foi entregue,
 * e a partir de agora ninguém mexe". Um botão que fecha sem olhar transforma
 * essa afirmação numa mentira útil — o mês fica travado com os erros dentro,
 * e o cadeado passa a proteger o erro em vez do número.
 *
 * Por isso o fecho passa por uma lista de verificações, e elas dividem-se em
 * duas classes que NÃO são a mesma coisa:
 *
 *   IMPEDE — o número ainda vai mudar. Documento por conferir muda o DRE
 *            quando alguém o conferir; meia-integração vai ter de ser
 *            corrigida dentro do mês; razão desbalanceado é defeito; e IVA
 *            divergente significa que a declaração entregue não diz o mesmo
 *            que os livros. Fechar sobre isto é travar um número errado.
 *
 *   AVISA  — o número é este, e há algo por explicar. A diferença na conta de
 *            controlo pode ser abertura por detalhar (ver `control.ts`), e o
 *            extrato por conciliar não muda o razão. Fica registado no fecho,
 *            que é onde alguém o vai procurar quando perguntar porquê.
 *
 * A diferença entre as duas é a pergunta "este número ainda vai mudar?". Se
 * vai, não se fecha. Se não vai, fecha-se e diz-se o que ficou por explicar.
 * ---------------------------------------------------------------------------
 *
 * Puro de propósito: é a única parte disto que se consegue testar sem banco,
 * e é onde está a decisão que interessa.
 */

export type ChaveDaVerificacao =
  | "porConferir"
  | "meiasIntegracoes"
  | "razaoDesbalanceado"
  | "vatDivergente"
  | "controloPagar"
  | "controloReceber"
  | "bancoPorFechar"
  | "mesAnteriorAberto";

export type Gravidade = "impede" | "avisa";

export type Verificacao = {
  chave: ChaveDaVerificacao;
  gravidade: Gravidade;
  /**
   * Quantos, ou quanto. A chave é que diz qual dos dois — a tela sabe ler,
   * o servidor não manda texto. Zero significa "está limpo".
   */
  valor: number;
  /** Contas envolvidas, quando ajudam a encontrar. */
  contas?: string[];
};

/**
 * A gravidade de cada verificação vive AQUI, e não em quem a mede.
 *
 * Estando junta, dá para ler a política inteira de uma vez e mudá-la num
 * sítio. Espalhada pelas medições, cada uma decidiria por si e a política
 * deixaria de existir como coisa.
 */
export const GRAVIDADE: Record<ChaveDaVerificacao, Gravidade> = {
  porConferir: "impede",
  meiasIntegracoes: "impede",
  razaoDesbalanceado: "impede",
  vatDivergente: "impede",
  controloPagar: "avisa",
  controloReceber: "avisa",
  bancoPorFechar: "avisa",
  // O primeiro fecho da vida do cliente tem sempre o mês anterior aberto. Se
  // isto impedisse, ninguém fecharia o primeiro mês — e sem o primeiro não há
  // segundo.
  mesAnteriorAberto: "avisa",
};

export function verificacao(
  chave: ChaveDaVerificacao, valor: number, contas?: string[]
): Verificacao {
  return { chave, gravidade: GRAVIDADE[chave], valor: arredondar(valor), ...(contas ? { contas } : {}) };
}

const arredondar = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** O que impede o fecho — vazio quer dizer que dá para fechar. */
export function impedimentos(v: Verificacao[]): Verificacao[] {
  return v.filter((x) => x.gravidade === "impede" && Math.abs(x.valor) > 0.004);
}

/** O que não impede mas fica registado. */
export function avisos(v: Verificacao[]): Verificacao[] {
  return v.filter((x) => x.gravidade === "avisa" && Math.abs(x.valor) > 0.004);
}

export function podeFechar(v: Verificacao[]): boolean {
  return impedimentos(v).length === 0;
}

// ------------------------------------------------------------------- datas

const dois = (n: number) => String(n).padStart(2, "0");

/** O primeiro e o último dia do mês, em ISO. */
export function limitesDoMes(ano: number, mes: number): { de: string; ate: string } {
  // Dia 0 do mês seguinte é o último dia deste — a única forma que não erra
  // em fevereiro nem em ano bissexto.
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { de: `${ano}-${dois(mes)}-01`, ate: `${ano}-${dois(mes)}-${dois(ultimo)}` };
}

export type PeriodoFechado = { periodStart: string; periodEnd: string };

/** Os meses que um intervalo toca, um a um. */
export function mesesEntre(de: string, ate: string): { de: string; ate: string }[] {
  const [a1, m1] = de.split("-").map(Number);
  const [a2, m2] = ate.split("-").map(Number);
  if (!a1 || !m1 || !a2 || !m2) return [];
  const meses: { de: string; ate: string }[] = [];
  for (let a = a1, m = m1; a < a2 || (a === a2 && m <= m2); ) {
    meses.push(limitesDoMes(a, m));
    // Guarda contra um intervalo invertido ou absurdo: sem ela, um `ate`
    // anterior ao `de` daria um ciclo infinito no servidor.
    if (meses.length > 600) break;
    m += 1;
    if (m > 12) { m = 1; a += 1; }
  }
  return meses;
}

/** Este mês está coberto por algum fecho? */
export function mesFechado(mes: { de: string; ate: string }, fechados: PeriodoFechado[]): boolean {
  return fechados.some((p) => p.periodStart <= mes.de && p.periodEnd >= mes.ate);
}

/**
 * O primeiro mês do intervalo que ainda NÃO está fechado, ou null se estão
 * todos.
 *
 * Devolve o mês e não um booleano porque a mensagem que interessa é "falta
 * fechar março", e não "o período não está fechado".
 */
export function primeiroMesAberto(
  de: string, ate: string, fechados: PeriodoFechado[]
): string | null {
  for (const m of mesesEntre(de, ate)) if (!mesFechado(m, fechados)) return m.de.slice(0, 7);
  return null;
}

/** O último dia fechado, para o cabeçalho da tela. */
export function fechadoAte(fechados: PeriodoFechado[]): string | null {
  return fechados.reduce<string | null>(
    (max, p) => (max === null || p.periodEnd > max ? p.periodEnd : max), null
  );
}
