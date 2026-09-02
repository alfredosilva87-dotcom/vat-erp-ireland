import { type Employee, type WeekHours } from "./payroll";

/**
 * O RECIBO — a parte que se pode provar sem banco nem PDF.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE DOCUMENTO É
 *
 * O payslip é o único papel do sistema que vai para a mão de quem trabalha. Um
 * relatório interno mal formatado irrita o escritório; um recibo mal feito faz
 * a pessoa duvidar do que lhe pagaram — e é ela que tem o direito legal de o
 * receber (Payment of Wages Act 1991: uma declaração escrita do bruto e de
 * cada dedução, em cada pagamento).
 *
 * ---------------------------------------------------------------------------
 * A REGRA QUE MANDA AQUI: AS LINHAS TÊM DE FECHAR COM O BRUTO
 *
 * O bruto vem do motor (`grossFor`), que sabe de `gross_override`, de contrato
 * fixo rateado e de domingo a taxa diferente. A decomposição em linhas é
 * APRESENTAÇÃO — e a apresentação nunca pode contradizer o número.
 *
 * Um recibo em que "40h × 16,35" dá 654,00 e o total diz 653,85 é um recibo que
 * alguém traz de volta ao balcão. Por isso `linhasDePagamento` reconcilia
 * sempre: o que sobrar entre a soma das linhas e o bruto sai numa linha própria
 * em vez de desaparecer.
 */

export type FreqType = "weekly" | "fortnightly" | "monthly";
export type Aviso = { codigo: string; params?: Record<string, string | number> };

/** Uma linha da coluna PAYMENTS. `horas` e `taxa` são nulos quando não se aplicam. */
export type LinhaDePagamento = {
  /** Chave de tradução — o recibo sai no idioma de quem o lê. */
  chave: string;
  horas: number | null;
  taxaCents: number | null;
  valorCents: number;
};

export type Payslip = {
  empregador: {
    nome: string;
    linhas: string[];
    /** Employer registered number — vai no recibo irlandês. */
    numeroDeEmpregador: string | null;
  };
  pessoa: {
    nome: string;
    codigo: string | null;
    cargo: string | null;
    pps: string | null;
    dataDeAdmissao: string | null;
  };
  periodo: {
    ano: number;
    numero: number;
    freq: FreqType;
    dataPagamento: string;
    /** As semanas ISO que este período cobre — o mensal cobre quatro ou cinco. */
    semanas: number[];
  };
  pagamentos: LinhaDePagamento[];
  brutoCents: number;
  descontos: { payeCents: number; uscCents: number; prsiCents: number; aeCents: number };
  liquidoCents: number;
  acumulado: {
    brutoCents: number; payeCents: number; uscCents: number;
    prsiCents: number; aeCents: number;
  };
  patrao: { prsiCents: number; aeCents: number; custoCents: number };
  fiscal: {
    base: string;
    cutOffCents: number;
    creditosCents: number;
    classePRSI: string | null;
    anoDaTabela: number | null;
    tabelaConferida: boolean;
  };
  mostrarHoras: boolean;
  /** Não fechado: o recibo sai com a tarja, e não se entrega. */
  rascunho: boolean;
  avisos: Aviso[];
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Euros → cêntimos inteiros. Tudo o que é dinheiro anda em cêntimos. */
export const cents = (v: unknown): number => Math.round(num(v) * 100);

/**
 * A decomposição do bruto em linhas.
 *
 * ---------------------------------------------------------------------------
 * POR QUE É QUE ELA RECONCILIA EM VEZ DE CONFIAR NA CONTA
 *
 * Há três formas de o bruto não bater com "horas × taxa":
 *
 *   · `gross_override` — alguém lançou o valor à mão, e o override MANDA;
 *   · contrato fixo — o valor é do período inteiro, rateado pelas semanas;
 *   · arredondamento — 38,5h × 16,35 dá 629,475, e o cêntimo tem de ir a algum
 *     lado.
 *
 * Em qualquer dos casos a diferença vai para uma linha visível. Um recibo cujas
 * linhas não somam ao total é o defeito mais caro deste documento: quem o
 * recebe não consegue conferir, e quem o emitiu não consegue explicar.
 */
export function linhasDePagamento(
  emp: Employee & { pay_type: string },
  horas: WeekHours[],
  brutoCents: number,
  mostrarHoras: boolean
): LinhaDePagamento[] {
  const linhas: LinhaDePagamento[] = [];

  const totalNormais = horas.reduce((s, h) => s + num(h.hours), 0);
  const totalDomingo = horas.reduce((s, h) => s + num(h.sunday_hours), 0);
  const totalFerias = horas.reduce((s, h) => s + num(h.holiday_hours), 0);
  const taxa = cents(emp.hourly_rate);
  const taxaDomingo = cents(emp.sunday_rate) || taxa;
  const porHora = emp.pay_type === "Hourly";

  /*
   * O override é o valor, e não uma correcção do valor.
   *
   * Mostrar "40h × 16,35" ao lado de um bruto lançado à mão sugeria uma conta
   * que não foi feita — e se as horas do livro não tivessem nada a ver com o
   * valor lançado, o recibo mentia com números que pareciam verificáveis.
   */
  const houveOverride = horas.some(
    (h) => h.gross_override !== null && h.gross_override !== undefined && h.gross_override !== ""
  );

  if (porHora && !houveOverride) {
    if (totalNormais > 0) {
      linhas.push({
        chave: "payslip.pay_basic",
        horas: mostrarHoras ? totalNormais : null,
        taxaCents: mostrarHoras ? taxa : null,
        valorCents: Math.round(totalNormais * taxa),
      });
    }
    if (totalDomingo > 0) {
      linhas.push({
        chave: "payslip.pay_sunday",
        horas: mostrarHoras ? totalDomingo : null,
        taxaCents: mostrarHoras ? taxaDomingo : null,
        valorCents: Math.round(totalDomingo * taxaDomingo),
      });
    }
  } else if (!porHora && !houveOverride) {
    // Contrato fixo: o valor já vem rateado pelas semanas trabalhadas do
    // período, e por isso não se recalcula aqui — mostra-se.
    linhas.push({
      chave: "payslip.pay_salary", horas: null, taxaCents: null, valorCents: brutoCents,
    });
  }

  const somado = linhas.reduce((s, l) => s + l.valorCents, 0);
  const resto = brutoCents - somado;
  if (resto !== 0 || !linhas.length) {
    /*
     * O nome da linha diz a verdade sobre a sua origem.
     *
     * Com override, o bruto INTEIRO é lançado à mão e a linha é "Pay". Sem
     * override, o resto é um acerto de cêntimos ou algo que o livro de horas
     * não explica — e chamar-lhe "Pay" escondia isso.
     */
    linhas.push({
      chave: houveOverride || !somado ? "payslip.pay_gross" : "payslip.pay_other",
      horas: null, taxaCents: null, valorCents: resto,
    });
  }

  /*
   * As férias GOZADAS não são uma linha de pagamento.
   *
   * O `holiday_hours` do livro é tempo usado do saldo, e já está pago dentro do
   * bruto da semana em que foi gozado — somá-lo aqui pagava duas vezes. Vai
   * como informação, com valor zero, porque a pessoa quer ver o saldo mexer.
   */
  if (mostrarHoras && totalFerias > 0) {
    linhas.push({
      chave: "payslip.pay_holidayTaken", horas: totalFerias, taxaCents: null, valorCents: 0,
    });
  }

  return linhas;
}

/**
 * O nome do ficheiro.
 *
 * Leva o nome da pessoa porque estes PDFs acabam todos na mesma pasta de
 * downloads, e "payslip.pdf" repetido doze vezes obriga a abrir um a um para
 * saber de quem é.
 */
export function nomeDoPayslip(
  nome: string, ano: number, periodo: number, freq: FreqType, rascunho = false
): string {
  const limpo = String(nome || "employee")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "employee";
  const etiqueta = freq === "monthly" ? "M" : freq === "fortnightly" ? "F" : "W";
  return `${rascunho ? "DRAFT-" : ""}payslip-${limpo}-${ano}-${etiqueta}${String(periodo).padStart(2, "0")}.pdf`;
}

/**
 * O rótulo do período tal como se lê no recibo: `Week 35`, `Month 9`.
 *
 * Devolve chave e parâmetro, e não a frase: o recibo de um trabalhador
 * brasileiro no mesmo escritório sai em português sem nada duplicado.
 */
export function rotuloDoPeriodo(freq: FreqType, periodo: number): Aviso {
  const chave = freq === "monthly" ? "payslip.periodMonth"
    : freq === "fortnightly" ? "payslip.periodFortnight" : "payslip.periodWeek";
  return { codigo: chave, params: { n: periodo } };
}
