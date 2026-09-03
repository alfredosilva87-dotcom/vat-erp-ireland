import { ppsValido } from "./funcionarioPuro";

/**
 * A SUBMISSÃO DE FOLHA À REVENUE (PSR) — a parte que se prova sozinha.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE FICHEIRO FAZ, E O QUE DELIBERADAMENTE NÃO FAZ
 *
 * Na Irlanda, desde a PAYE Modernisation (2019), o empregador comunica **cada
 * pagamento, no dia ou antes do dia em que paga**. Não há resumo anual: o P35
 * acabou. O que se comunica chama-se *Payroll Submission Request* e vai por
 * ROS.
 *
 * Aqui monta-se e **critica-se** essa submissão. O que aqui NÃO está é o envio
 * propriamente dito: falar com o ROS exige o certificado digital do escritório
 * e assinar cada pedido com ele. Isso é uma credencial, e uma credencial não
 * entra num sistema sem quem manda nela decidir como.
 *
 * A separação também é útil: hoje o escritório já submete pelo ROS à mão. O que
 * lhe falta não é um canal novo — é saber, **antes**, que a submissão está
 * completa, e ficar com registo do que foi comunicado. É isso que está aqui.
 *
 * ---------------------------------------------------------------------------
 * A CRÍTICA VALE MAIS DO QUE O FICHEIRO
 *
 * Uma submissão rejeitada pela Revenue descobre-se e corrige-se. Uma submissão
 * ACEITE com um número errado não dá sinal nenhum: fica na conta do empregador
 * e aparece meses depois, com juros. Por isso o que impede o envio (`bloqueia`)
 * está separado do que só merece atenção.
 */

export type Freq = "weekly" | "fortnightly" | "monthly";

export type LinhaPSR = {
  employeeId: string;
  nome: string;
  /** PPS. Sem ele a Revenue não sabe de quem se trata. */
  pps: string | null;
  /**
   * O ID DO VÍNCULO, e não da pessoa.
   *
   * A mesma pessoa pode ter dois empregos na mesma empresa (sai e volta, ou
   * dois contratos). O `employmentID` é o que os distingue, e é obrigatório na
   * submissão desde 2019 — sem ele a Revenue junta os dois vínculos e o crédito
   * fiscal é repartido pelo emprego errado.
   */
  employmentId: string | null;
  dataPagamento: string;
  freq: Freq;
  brutoCents: number;
  /** Base tributável. Igual ao bruto enquanto não houver pensão dedutível. */
  tributavelCents: number;
  payeCents: number;
  uscCents: number;
  prsiEmpregadoCents: number;
  prsiEmpregadorCents: number;
  classePRSI: string | null;
  semanasSeguraveis: number;
  /** Auto-enrolment: informativo, não é imposto. */
  aeEmpregadoCents: number;
  aeEmpregadorCents: number;
};

export type Reparo = {
  codigo: string;
  params?: Record<string, string | number>;
  /** Impede o envio, ou só merece um olhar? */
  bloqueia: boolean;
};

const PERIODOS: Record<Freq, number> = { weekly: 1, fortnightly: 2, monthly: 0 };

/**
 * SEMANAS SEGURÁVEIS — o campo do PSR que ninguém confere e que decide
 * benefícios sociais.
 *
 * ---------------------------------------------------------------------------
 * POR QUE É QUE ISTO IMPORTA MAIS DO QUE PARECE
 *
 * As semanas seguráveis não mexem em imposto nenhum. Mexem no que a pessoa tem
 * direito a receber do Estado: subsídio de doença, subsídio de desemprego,
 * pensão. Um erro aqui não aparece na conta de ninguém — aparece anos depois, à
 * pessoa, quando ela precisa.
 *
 * A regra: contam-se as semanas do período em que houve emprego segurável.
 * Semanal dá 1, quinzenal dá 2, e mensal dá **4 ou 5** conforme o mês — não 4
 * sempre, que é o atalho errado que faz faltar doze semanas ao fim de um ano.
 *
 * Quem entrou ou saiu a meio do período leva menos, e é por isso que as semanas
 * COM TRABALHO entram na conta em vez de se usar só o comprimento do período.
 *
 * O recurso final existe para o caso do valor lançado à mão: houve pagamento e
 * o livro de horas não tem nada marcado. Devolver zero ali seria dizer à
 * Revenue que a pessoa recebeu sem estar empregada.
 */
export function semanasSeguraveis(args: {
  freq: Freq;
  /** As semanas ISO que o período cobre — o mensal cobre 4 ou 5. */
  semanasDoPeriodo: number[];
  /** Dessas, aquelas em que houve horas, domingo, férias ou semana marcada. */
  semanasComTrabalho: number[];
  brutoCents: number;
}): number {
  const cobertas = args.semanasDoPeriodo.length
    || PERIODOS[args.freq]
    || 4;
  if (args.brutoCents <= 0) return 0;

  const trabalhadas = args.semanasComTrabalho
    .filter((w) => args.semanasDoPeriodo.includes(w)).length;

  // Houve pagamento e nenhuma semana marcada: o livro de horas não sabe, mas o
  // dinheiro sabe. Conta-se o período inteiro em vez de zero.
  if (!trabalhadas) return cobertas;
  return Math.min(trabalhadas, cobertas);
}

/**
 * O que impede — e o que só preocupa.
 *
 * Cada reparo é chave + parâmetros, e não frase: o escritório trabalha em três
 * idiomas e uma mensagem de servidor pré-formatada sai sempre no idioma errado
 * para alguém.
 */
export function criticarLinha(l: LinhaPSR): Reparo[] {
  const r: Reparo[] = [];

  if (!l.pps) {
    r.push({ codigo: "psr.semPps", bloqueia: true });
  } else if (!ppsValido(l.pps)) {
    /*
     * Um PPS com o dígito de controlo errado é PIOR do que um PPS em falta.
     * Em falta, a Revenue recusa. Errado, ela pode aceitar contra outra pessoa
     * — e aí o imposto de quem trabalhou aqui foi creditado a um estranho.
     */
    r.push({ codigo: "psr.ppsInvalido", params: { pps: l.pps }, bloqueia: true });
  }

  if (!l.employmentId) {
    r.push({ codigo: "psr.semEmploymentId", bloqueia: true });
  }

  if (!l.classePRSI) r.push({ codigo: "psr.semClassePrsi", bloqueia: true });

  if (l.semanasSeguraveis <= 0 && l.brutoCents > 0) {
    r.push({ codigo: "psr.semSemanas", bloqueia: true });
  }

  /*
   * Bruto e tributável iguais é o NORMAL neste sistema — a AE não desgrava, e
   * não há aqui pensão ocupacional dedutível. Se um dia divergirem sem que
   * alguém tenha construído a dedução, é sinal de erro e não de feitio.
   */
  if (l.tributavelCents > l.brutoCents) {
    r.push({ codigo: "psr.tributavelMaior", bloqueia: true });
  }

  if (l.brutoCents <= 0) {
    // Não bloqueia: comunica-se um pagamento a zero quando alguém está de
    // licença sem vencimento, e isso é legítimo.
    r.push({ codigo: "psr.brutoZero", bloqueia: false });
  }

  if (l.payeCents < 0) {
    // Devolução de PAYE é normal na base cumulativa — e é a linha que mais dá
    // vontade de "corrigir" a quem não conhece a regra.
    r.push({ codigo: "psr.payeDevolvido", params: { v: (-l.payeCents / 100).toFixed(2) }, bloqueia: false });
  }

  return r;
}

/**
 * A data-limite: comunica-se **no dia do pagamento ou antes**.
 *
 * Não há tolerância nem prazo no mês seguinte — é essa a mudança inteira da
 * PAYE Modernisation, e é o que mais apanha quem vem de um sistema antigo.
 * Devolve os dias de atraso (0 = em dia).
 */
export function diasDeAtraso(dataPagamento: string, hoje: string): number {
  const p = Date.parse(dataPagamento + "T00:00:00Z");
  const h = Date.parse(hoje + "T00:00:00Z");
  if (!Number.isFinite(p) || !Number.isFinite(h)) return 0;
  return Math.max(0, Math.round((h - p) / 86400000));
}

/** Os totais que a Revenue confere contra o que o empregador paga. */
export function totaisDaSubmissao(linhas: LinhaPSR[]) {
  const soma = (f: (l: LinhaPSR) => number) => linhas.reduce((s, l) => s + f(l), 0);
  const paye = soma((l) => l.payeCents);
  const usc = soma((l) => l.uscCents);
  const prsiEe = soma((l) => l.prsiEmpregadoCents);
  const prsiEr = soma((l) => l.prsiEmpregadorCents);
  return {
    pessoas: linhas.length,
    bruto: soma((l) => l.brutoCents),
    paye, usc, prsiEe, prsiEr,
    semanas: soma((l) => l.semanasSeguraveis),
    /*
     * O QUE SE PAGA À REVENUE — e é isto que vai para o P30 mensal.
     *
     * PAYE + USC + as DUAS partes do PRSI. Esquecer a parte do empregador é o
     * erro clássico: a submissão fecha, a conta do mês vem maior do que o
     * escritório provisionou, e ninguém percebe de onde saiu a diferença.
     */
    aPagar: paye + usc + prsiEe + prsiEr,
  };
}
