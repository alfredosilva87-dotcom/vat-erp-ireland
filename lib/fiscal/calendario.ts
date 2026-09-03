/**
 * O CALENDÁRIO DE OBRIGAÇÕES — que declaração, de que período, para que dia.
 *
 * ---------------------------------------------------------------------------
 * O QUE FALTAVA
 *
 * `formaJuridica.ts` já sabia QUE obrigações cada forma tem: sole trader
 * entrega Form 11, sociedade entrega CT1 e as contas anuais no CRO. Mas isso
 * era uma lista descritiva — o gerador de obrigações só criava VAT3 e RTD.
 *
 * Resultado: a agenda fiscal mostrava o IVA e mais nada. O imposto sobre o
 * lucro e a publicação das contas — as duas com coima por atraso — não tinham
 * data em lado nenhum, e a única coisa que as lembrava era a memória de alguém.
 *
 * ---------------------------------------------------------------------------
 * NÃO SE INVENTA DATA
 *
 * Duas destas obrigações dependem de um dado do cadastro que o sistema não
 * consegue deduzir: o FIM DO EXERCÍCIO (o CT1 corre 9 meses a partir dele) e a
 * DATA DA ANUAL no CRO (a B1 vence 56 dias depois dela, e ela vem da própria
 * constituição da empresa — não do calendário fiscal).
 *
 * Quando falta, a obrigação nasce **sem vencimento** em vez de nascer com um
 * vencimento plausível. Não é preguiça: `classificar` em agenda.ts pinta de
 * AMARELO uma obrigação sem prazo, precisamente porque "é um cadastro por
 * completar". Uma data inventada ficaria verde e não voltaria a ser vista.
 * ---------------------------------------------------------------------------
 *
 * Puro e sem banco: entram os dados do cadastro e o ano, sai a lista. É por
 * isso que cada regra de prazo se testa com a lei na mão.
 */

import type { FormaJuridica } from "./formaJuridica";

export type TipoGerado = "VAT3" | "RTD" | "CT1" | "B1" | "FORM11" | "PRELIMINARY_TAX";

/** O que falta no cadastro para se saber a data. */
export type FaltaNoCadastro = "financialYearEnd" | "annualReturnDate";

export type ObrigacaoGerada = {
  kind: TipoGerado;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  /** Nulo quando falta o dado do cadastro que a define. Ver o bloco acima. */
  dueDate: string | null;
  falta?: FaltaNoCadastro;
};

export type DadosDoCliente = {
  forma: FormaJuridica | null | undefined;
  registadoParaVat: boolean;
  /** `MM-DD` — o dia em que o exercício fecha. Vazio significa por preencher. */
  fimDoExercicio?: string | null;
  /** A Annual Return Date do CRO, em ISO. Vazia significa por preencher. */
  dataDaAnual?: string | null;
  /**
   * A DATA A PARTIR DA QUAL ESTE CLIENTE TEM OBRIGAÇÕES.
   *
   * Sem ela, um cliente registado hoje nascia com três VAT3 em atraso de
   * períodos em que não era cliente de ninguém — e a agenda fiscal, que está
   * ordenada "pelo mais urgente", punha-o a vermelho no topo, à frente dos
   * atrasos verdadeiros. Com uma carteira a crescer é assim que um alarme
   * deixa de ser lido.
   *
   * Vazia mantém o comportamento antigo (o ano inteiro), porque é o que os
   * clientes já cadastrados esperam.
   */
  obrigacoesDesde?: string | null;
};

const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dois = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** O último dia do mês — `dia 0` do mês seguinte, que não erra em bissexto. */
const ultimoDia = (ano: number, mes1a12: number) => new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();

/**
 * O DIA 23 é o prazo de quem entrega pelo ROS.
 *
 * A lei diz 21; quem entrega e paga por via electrónica — que é toda a gente,
 * há anos — tem até ao 23. Usar o 21 daria a toda a agenda dois dias de folga
 * que ninguém usa, e faria o semáforo ficar vermelho cedo de mais.
 */
const DIA_ROS = 23;

/**
 * O fim do exercício, como data de um ano concreto.
 *
 * `MM-DD` e não uma data completa porque o fecho repete-se todos os anos, e
 * guardar 2026-12-31 obrigaria a editar o cadastro em cada Janeiro.
 */
export function fimDoExercicioEm(ano: number, mmdd: string | null | undefined): string {
  const m = /^(\d{2})-(\d{2})$/.exec((mmdd ?? "").trim());
  // Sem nada preenchido assume-se 31/12 para haver um período de que falar —
  // mas quem chama marca `falta`, e a obrigação sai sem vencimento.
  if (!m) return `${ano}-12-31`;
  const mes = Math.min(12, Math.max(1, Number(m[1])));
  const dia = Math.min(ultimoDia(ano, mes), Math.max(1, Number(m[2])));
  return `${ano}-${dois(mes)}-${dois(dia)}`;
}

/** O dia seguinte, em ISO. */
const diaSeguinte = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return iso(t);
};

/** Soma meses e cai no dia 23 desse mês — a forma dos prazos irlandeses. */
function mesesDepoisNoDia23(data: string, meses: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  const ano = d.getUTCFullYear();
  const mes = d.getUTCMonth() + 1 + meses;
  const anoFinal = ano + Math.floor((mes - 1) / 12);
  const mesFinal = ((mes - 1) % 12 + 12) % 12 + 1;
  return `${anoFinal}-${dois(mesFinal)}-${dois(DIA_ROS)}`;
}

/** Soma dias corridos. É assim que o CRO conta os 56 dias da B1. */
function maisDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return iso(d);
}

// ------------------------------------------------------------------ o IVA

/** Os seis períodos bimestrais do IVA, e o resumo anual. */
export function obrigacoesDeVat(ano: number): ObrigacaoGerada[] {
  const linhas: ObrigacaoGerada[] = [];
  for (let m = 0; m < 12; m += 2) {
    const inicio = `${ano}-${dois(m + 1)}-01`;
    const fim = `${ano}-${dois(m + 2)}-${dois(ultimoDia(ano, m + 2))}`;
    linhas.push({
      kind: "VAT3",
      periodLabel: `${MESES[m]}–${MESES[m + 1]} ${ano}`,
      periodStart: inicio, periodEnd: fim,
      // O VAT3 vence no dia 23 do mês SEGUINTE ao fim do período.
      dueDate: mesesDepoisNoDia23(fim, 1),
    });
  }
  linhas.push({
    kind: "RTD",
    periodLabel: `RTD ${ano}`,
    periodStart: `${ano}-01-01`, periodEnd: `${ano}-12-31`,
    dueDate: `${ano + 1}-01-${dois(DIA_ROS)}`,
  });
  return linhas;
}

// -------------------------------------------------- o imposto e as contas

/**
 * Tudo o que este cliente tem de entregar no ano, com período e prazo.
 *
 * O recorte é o ANO CIVIL, e para o CT1 isso quer dizer "o exercício que FECHA
 * neste ano". Uma empresa com fecho em Junho tem o exercício a cavalo em dois
 * anos civis, e pô-lo no ano em que começa faria a obrigação aparecer um ano
 * antes de existir.
 */
export function obrigacoesDoAno(ano: number, c: DadosDoCliente): ObrigacaoGerada[] {
  return desde(gerarDoAno(ano, c), c.obrigacoesDesde);
}

/**
 * Corta o que acabou ANTES de o cliente existir na carteira.
 *
 * O corte é pelo FIM do período, não pelo prazo: um VAT3 de Jan–Fev vence em
 * Março, e cortar pelo prazo deixaria entrar um período inteiro em que o
 * cliente não era cliente. Um período que ainda estava a correr quando ele
 * entrou fica — essa parte é mesmo dele.
 */
function desde(linhas: ObrigacaoGerada[], data: string | null | undefined): ObrigacaoGerada[] {
  const d = String(data ?? "").trim();
  if (!d) return linhas;
  return linhas.filter((l) => l.periodEnd >= d);
}

function gerarDoAno(ano: number, c: DadosDoCliente): ObrigacaoGerada[] {
  const doVat = c.registadoParaVat ? obrigacoesDeVat(ano) : [];
  if (!c.forma) return doVat;

  if (c.forma === "sole_trader") {
    /*
     * A Form 11 do ano X entrega-se em 31 de Outubro de X+1, e o pagamento por
     * conta do ano seguinte tem a MESMA data — é o "pay and file" numa só ida.
     *
     * São duas linhas e não uma porque são dois actos com valores diferentes:
     * uma acerta o ano passado, a outra antecipa o corrente. Juntá-las numa só
     * faria desaparecer da agenda metade do dinheiro que sai nesse dia.
     */
    const prazo = `${ano + 1}-10-31`;
    return [
      ...doVat,
      {
        kind: "FORM11",
        periodLabel: `Form 11 ${ano}`,
        periodStart: `${ano}-01-01`, periodEnd: `${ano}-12-31`,
        dueDate: prazo,
      },
      {
        kind: "PRELIMINARY_TAX",
        periodLabel: `Preliminary tax ${ano + 1}`,
        periodStart: `${ano + 1}-01-01`, periodEnd: `${ano + 1}-12-31`,
        dueDate: prazo,
      },
    ];
  }

  // ------------------------------------------------------------ sociedade
  const temFecho = Boolean((c.fimDoExercicio ?? "").trim());
  const fim = fimDoExercicioEm(ano, c.fimDoExercicio);
  // O exercício são os doze meses que acabam nessa data.
  const inicio = diaSeguinte(fimDoExercicioEm(ano - 1, c.fimDoExercicio));

  const linhas: ObrigacaoGerada[] = [
    ...doVat,
    {
      kind: "CT1",
      periodLabel: `CT1 ${ano}`,
      periodStart: inicio, periodEnd: fim,
      /*
       * Nove meses depois do fecho, no dia 23 desse mês.
       *
       * Fecho em 31/12/2026 → Setembro de 2027 → 23/09/2027. É a regra dos
       * "nove meses" com o prazo do ROS por cima; a lei diz 21, e ninguém
       * entrega em papel há anos.
       */
      dueDate: temFecho ? mesesDepoisNoDia23(fim, 9) : null,
      ...(temFecho ? {} : { falta: "financialYearEnd" as const }),
    },
    {
      kind: "PRELIMINARY_TAX",
      periodLabel: `Preliminary CT ${ano}`,
      periodStart: inicio, periodEnd: fim,
      /*
       * O pagamento por conta vence ANTES do fim do próprio exercício: 31 dias
       * antes do fecho, e nunca depois do dia 23 desse mês. É a regra das
       * empresas pequenas, que é a esmagadora maioria aqui.
       */
      dueDate: temFecho ? mesesDepoisNoDia23(maisDias(fim, -31), 0) : null,
      ...(temFecho ? {} : { falta: "financialYearEnd" as const }),
    },
    {
      kind: "B1",
      periodLabel: `Annual Return ${ano}`,
      periodStart: inicio, periodEnd: fim,
      /*
       * A B1 é o único prazo que NÃO sai do calendário fiscal.
       *
       * Ela conta 56 dias a partir da Annual Return Date, que vem da
       * constituição da empresa e está na ficha do CRO. Sem esse dado não há
       * como saber — e é por isso que ela nasce sem vencimento em vez de
       * nascer com um palpite. Ver o bloco no topo do ficheiro.
       */
      dueDate: c.dataDaAnual ? maisDias(anualNoAno(ano, c.dataDaAnual), 56) : null,
      ...(c.dataDaAnual ? {} : { falta: "annualReturnDate" as const }),
    },
  ];
  return linhas;
}

/**
 * A data da anual repetida no ano pedido.
 *
 * Guarda-se a data completa porque a primeira vem da constituição, mas ela
 * repete-se todos os anos no mesmo dia — usar o ano gravado faria a obrigação
 * de 2027 vencer numa data de 2019.
 */
export function anualNoAno(ano: number, dataDaAnual: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataDaAnual.trim());
  if (!m) return `${ano}-12-31`;
  const mes = Number(m[2]);
  const dia = Math.min(ultimoDia(ano, mes), Number(m[3]));
  return `${ano}-${dois(mes)}-${dois(dia)}`;
}

/** As que o gerador de IVA já tratava — para o resto do sistema não as repetir. */
export const KINDS_DE_VAT: TipoGerado[] = ["VAT3", "RTD"];
export const ehDeVat = (kind: string): boolean => KINDS_DE_VAT.includes(kind as TipoGerado);
