import "server-only";
import { degrees, rgb } from "pdf-lib";
import { A4, Folha, MARGEM, LARGURA } from "@/lib/accounting/pdfKit";
import { rgbDe } from "@/lib/reportBrand";
import { rotuloDoPeriodo, type Payslip } from "@/lib/hr/payslipPuro";
import type { Traduzir } from "@/lib/i18nServer";

/**
 * O RECIBO EM PDF — o papel que vai para a mão de quem trabalha.
 *
 * ---------------------------------------------------------------------------
 * DESENHADO A PARTIR DO PAYSLIP REAL DELE
 *
 * O modelo é o recibo do Sage que o Alfredo mandou (semana 35 de 2026): duas
 * colunas — PAYMENTS à esquerda, DEDUCTIONS à direita —, o líquido em caixa
 * própria, e por baixo as duas tiras que ninguém lê todas as semanas mas que
 * são as que respondem às perguntas: o ACUMULADO DO ANO e os DADOS FISCAIS
 * (base, cut-off, créditos, classe de PRSI).
 *
 * Foi por essas tiras que o motor se conseguiu conferir ao cêntimo. Um recibo
 * que mostra só bruto e líquido é um recibo impossível de contestar — e é
 * exactamente por isso que este mostra o resto.
 *
 * ---------------------------------------------------------------------------
 * UMA PESSOA POR PÁGINA, SEMPRE
 *
 * Mesmo quando se imprime a empresa inteira num ficheiro só. Recibos de duas
 * pessoas na mesma folha acabam entregues à pessoa errada — e o que lá está é
 * o salário de alguém.
 */

const eur = (c: number): string =>
  (c / 100).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const horasTexto = (h: number): string =>
  h.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dataIE = (iso: string | null): string => {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return d && m && a ? `${d}/${m}/${a}` : String(iso);
};

/** Nome de uma chave de tradução, com recurso ao próprio valor. */
const rotuloDaBase = (base: string): string =>
  base === "emergencia" ? "payslip.basis_emergency"
    : base === "semana1" ? "payslip.basis_week1" : "payslip.basis_cumulative";

const GUTTER = 16;
const COL = (LARGURA - GUTTER) / 2;
const ESQ = MARGEM;
const DIR = MARGEM + COL + GUTTER;

export async function pdfDosPayslips(recibos: Payslip[], t: Traduzir): Promise<Uint8Array> {
  const s = await Folha.criar();

  for (const p of recibos) {
    s.novaPagina();
    desenhar(s, p, t);
  }
  if (!recibos.length) s.novaPagina();

  return s.bytes();
}

function desenhar(s: Folha, p: Payslip, t: Traduzir): void {
  // ------------------------------------------------------------- o timbre
  s.faixa(0, A4.h - 8, A4.w, 8, "primary");
  s.faixa(0, A4.h - 11, A4.w, 3, "accent");

  let y = A4.h - 32;
  s.texto(p.empregador.nome, ESQ, y, { size: 13, bold: true, c: "primary", max: 46 });
  s.textoDireita(t("payslip.title"), A4.w - MARGEM, y, { size: 17, bold: true, c: "primary" });

  y -= 12;
  const rot = rotuloDoPeriodo(p.periodo.freq, p.periodo.numero);
  s.textoDireita(`${t(rot.codigo, rot.params)} · ${p.periodo.ano}`, A4.w - MARGEM, y,
    { size: 9.5, bold: true, c: "text" });

  const linhasEmpregador = [...p.empregador.linhas];
  if (p.empregador.numeroDeEmpregador) {
    linhasEmpregador.push(`${t("payslip.employerNo")}: ${p.empregador.numeroDeEmpregador}`);
  }
  let yE = y;
  for (const l of linhasEmpregador.slice(0, 4)) {
    s.texto(l, ESQ, yE, { size: 7.5, c: "muted", max: 60 });
    yE -= 9.5;
  }

  y -= 12;
  s.textoDireita(`${t("payslip.payDate")}: ${dataIE(p.periodo.dataPagamento)}`,
    A4.w - MARGEM, y, { size: 8, c: "muted" });

  s.y = Math.min(yE, y) - 10;

  // ---------------------------------------------------------- a pessoa
  s.regua(s.y, "border");
  s.avanca(16);
  s.texto(p.pessoa.nome, ESQ, s.y, { size: 12, bold: true, max: 50 });
  s.avanca(14);

  const identidade: [string, string][] = [
    [t("payslip.pps"), p.pessoa.pps || "—"],
    [t("payslip.staffNo"), p.pessoa.codigo || "—"],
    [t("payslip.role"), p.pessoa.cargo || "—"],
    [t("payslip.started"), dataIE(p.pessoa.dataDeAdmissao)],
  ];
  identidade.forEach(([k, v], i) => {
    const x = ESQ + (i % 4) * (LARGURA / 4);
    s.texto(k.toUpperCase(), x, s.y, { size: 6.5, c: "muted", max: 22 });
    s.texto(v, x, s.y - 10, { size: 9, max: 26 });
  });
  s.avanca(24);
  s.regua(s.y, "border");
  s.avanca(12);

  // -------------------------------------------------- pagamentos e descontos
  const topo = s.y;

  const totalDescontos = p.descontos.payeCents + p.descontos.uscCents
    + p.descontos.prsiCents + p.descontos.aeCents;

  const fimEsq = coluna(s, ESQ, topo, t("payslip.payments"), p.mostrarHoras, [
    ...p.pagamentos.map((l) => ({
      rotulo: t(l.chave),
      horas: l.horas === null ? null : horasTexto(l.horas),
      taxa: l.taxaCents === null ? null : eur(l.taxaCents),
      valor: l.valorCents,
      // A linha de férias gozadas é informação, não pagamento: sai sem valor.
      semValor: l.chave === "payslip.pay_holidayTaken",
    })),
  ], t("payslip.grossPay"), p.brutoCents);

  const fimDir = coluna(s, DIR, topo, t("payslip.deductions"), false, [
    { rotulo: t("payslip.paye"), horas: null, taxa: null, valor: p.descontos.payeCents },
    { rotulo: t("payslip.usc"), horas: null, taxa: null, valor: p.descontos.uscCents },
    { rotulo: t("payslip.prsi"), horas: null, taxa: null, valor: p.descontos.prsiCents },
    ...(p.descontos.aeCents
      ? [{ rotulo: t("payslip.ae"), horas: null, taxa: null, valor: p.descontos.aeCents }]
      : []),
  ], t("payslip.totalDeductions"), totalDescontos);

  /*
   * As colunas partilham o fundo mais baixo, e nunca sobem acima de uma altura
   * minima. Sem o minimo, um recibo de uma linha so deixava o bloco do liquido
   * colado ao cabecalho e meia pagina em branco por baixo — parecia um
   * documento cortado a meio.
   */
  s.y = Math.min(fimEsq, fimDir, topo - 128) - 20;

  // ------------------------------------------------------------- o líquido
  const ALTURA = 40;
  const caixaY = s.y - ALTURA;
  s.faixa(ESQ, caixaY, LARGURA, ALTURA, "primary");
  s.texto(t("payslip.netPay").toUpperCase(), ESQ + 14, caixaY + 15,
    { size: 11, bold: true, c: "surface" });
  s.textoDireita(`EUR ${eur(p.liquidoCents)}`, A4.w - MARGEM - 14, caixaY + 12,
    { size: 18, bold: true, c: "surface" });
  s.y = caixaY - 18;

  /*
   * ESTE PERÍODO ao lado do ACUMULADO — a forma do payslip irlandês.
   *
   * É assim que o Sage o imprime, e não por hábito: o número da semana sozinho
   * não se confere contra nada, e o acumulado sozinho não diz nada a quem
   * recebe. Lado a lado, vê-se num relance se a semana foge do padrão do ano.
   *
   * A linha TAXABLE PAY está aqui de propósito, igual ao bruto: é ela que
   * responde à pergunta "e a pensão, não abate no imposto?" — no auto-enrolment
   * não abate, e o papel mostra-o em vez de o deixar por explicar.
   */
  duasColunas(s, t("payslip.thisPeriod"), t("payslip.ytd"), [
    [t("payslip.grossPay"), p.brutoCents, p.acumulado.brutoCents],
    [t("payslip.taxablePay"), p.tributavelCents, p.acumulado.brutoCents],
    [t("payslip.paye"), p.descontos.payeCents, p.acumulado.payeCents],
    [t("payslip.usc"), p.descontos.uscCents, p.acumulado.uscCents],
    [t("payslip.prsi"), p.descontos.prsiCents, p.acumulado.prsiCents],
    [t("payslip.ae"), p.descontos.aeCents, p.acumulado.aeCents],
  ]);

  /*
   * OS DADOS FISCAIS.
   *
   * Sem cut-off e créditos à vista, "porque é que esta semana reteve tanto?"
   * não tem resposta possível sem abrir o sistema. Com eles, responde-se
   * olhando — e foi assim que se conferiu o motor contra o Sage.
   *
   * O valor DO PERÍODO vem primeiro porque é o que a pessoa reconhece: no
   * recibo dele o crédito semanal de 76,93 está impresso, e é por ele que
   * alguém confere. O acumulado de 2.692,55 na semana 35 não se compara com
   * coisa nenhuma.
   */
  tira(s, t("payslip.taxDetails"), [
    [t("payslip.basis"), t(rotuloDaBase(p.fiscal.base))],
    [t("payslip.cutOffTp"), eur(p.fiscal.cutOffPeriodoCents)],
    [t("payslip.creditsTp"), eur(p.fiscal.creditosPeriodoCents)],
    [t("payslip.cutOff"), eur(p.fiscal.cutOffCents)],
    [t("payslip.credits"), eur(p.fiscal.creditosCents)],
  ]);

  tira(s, t("payslip.insurance"), [
    [t("payslip.prsiClass"), p.fiscal.classePRSI || "—"],
    // As semanas seguraveis nao mexem em imposto: mexem no que a pessoa tem
    // direito a receber do Estado. Por isso vao no papel dela.
    [t("payslip.insWeeks"), String(p.fiscal.semanasSeguraveis)],
    [t("payslip.taxYear"), String(p.fiscal.anoDaTabela ?? p.periodo.ano)],
    [t("payslip.prsiEr"), eur(p.patrao.prsiCents)],
    [t("payslip.aeEr"), eur(p.patrao.aeCents)],
  ]);

  /*
   * OS AVISOS SÓ SAEM NO RASCUNHO.
   *
   * São para quem confere antes de fechar — "sem PPS", "tabela por confirmar",
   * "buraco no acumulado". Num recibo já fechado e entregue seriam ruído para
   * quem o recebe, sobre coisas que já não estão em aberto.
   */
  if (p.rascunho && p.avisos.length) {
    s.avanca(6);
    s.texto(t("payslip.warnings"), ESQ, s.y, { size: 7, bold: true, c: "warning", max: 40 });
    s.avanca(10);
    for (const a of p.avisos.slice(0, 4)) {
      s.y = s.paragrafo("· " + t(a.codigo, a.params), ESQ, s.y, LARGURA,
        { size: 7, c: "warning" });
    }
  }

  // ------------------------------------------------------------- o rodapé
  s.regua(MARGEM - 8, "border", 0.6);
  s.texto(
    p.rascunho ? t("payslip.footerDraft") : t("payslip.footer"),
    ESQ, MARGEM - 19, { size: 6.5, c: "muted", max: 150 }
  );
  s.faixa(0, 0, A4.w, 5, "primary");

  // Por último, para nenhuma faixa lhe passar por cima.
  if (p.rascunho) tarjaDeRascunho(s, t);
}

/**
 * A TARJA DE RASCUNHO — desenhada POR CIMA de tudo, e no fim.
 *
 * Atravessada e grande, não numa nota de rodapé que ninguém lê: um rascunho
 * impresso e entregue por engano é dinheiro comunicado a alguém e depois
 * desmentido.
 *
 * Ficava por baixo do conteúdo e as faixas opacas cortavam-lhe pedaços — no
 * papel lia-se meio "DRAFT" atrás do bloco do líquido. Uma tarja que se vê mal
 * é pior do que nenhuma: dá a impressão de que o documento está marcado quando
 * na prática não está.
 */
function tarjaDeRascunho(s: Folha, t: Traduzir): void {
  const c = rgbDe("accent");
  const palavra = t("payslip.draft");
  // A palavra muda de tamanho em cada idioma — DRAFT, RASCUNHO, BORRADOR —,
  // por isso mede-se e centra-se a partir do meio do papel.
  const tamanho = palavra.length > 6 ? 62 : 84;
  const largura = s.larguraDe(palavra, tamanho, true, 20);
  const rad = (38 * Math.PI) / 180;
  s.pagina.drawText(palavra, {
    x: A4.w / 2 - (Math.cos(rad) * largura) / 2,
    y: A4.h / 2 - (Math.sin(rad) * largura) / 2 - 40,
    size: tamanho, font: s.f.negrito,
    color: rgb(c.r, c.g, c.b), rotate: degrees(38), opacity: 0.22,
  });
}


type LinhaDeColuna = {
  rotulo: string; horas: string | null; taxa: string | null;
  valor: number; semValor?: boolean;
};

/**
 * Uma coluna com cabeçalho, linhas e total.
 *
 * Devolve o `y` do fim para quem chama alinhar as duas colunas pela mais
 * comprida — sem isso, o bloco do líquido subia por cima da coluna maior
 * sempre que uma pessoa tivesse mais linhas de pagamento do que de desconto.
 */
function coluna(
  s: Folha, x: number, topo: number, titulo: string, comHoras: boolean,
  linhas: LinhaDeColuna[], rotuloTotal: string, total: number
): number {
  const direita = x + COL;
  let y = topo;

  s.faixa(x, y - 15, COL, 15, "primary");
  s.texto(titulo.toUpperCase(), x + 8, y - 11, { size: 7.5, bold: true, c: "surface", max: 30 });
  s.textoDireita("EUR", direita - 8, y - 11, { size: 7, bold: true, c: "surface" });
  y -= 24;

  if (comHoras) {
    s.texto("HRS", x + 118, y, { size: 6, c: "muted" });
    s.texto("RATE", x + 156, y, { size: 6, c: "muted" });
    y -= 9;
  }

  for (const l of linhas) {
    s.texto(l.rotulo, x + 8, y, { size: 8.5, max: 26 });
    if (l.horas) s.textoDireita(l.horas, x + 145, y, { size: 8, c: "muted" });
    if (l.taxa) s.textoDireita(l.taxa, x + 188, y, { size: 8, c: "muted" });
    if (!l.semValor) s.textoDireita(eur(l.valor), direita - 8, y, { size: 8.5 });
    y -= 13;
  }

  y -= 3;
  s.regua(y + 6, "border", 0.6, x, direita);
  s.texto(rotuloTotal, x + 8, y - 4, { size: 8.5, bold: true, max: 26 });
  s.textoDireita(eur(total), direita - 8, y - 4, { size: 9.5, bold: true });
  return y - 12;
}

/**
 * O bloco de duas colunas de valor: ESTE PERÍODO | ACUMULADO.
 *
 * Duas colunas e não duas tiras separadas, porque a comparação é a razão de
 * existirem: o olho tem de saltar da esquerda para a direita na mesma linha, e
 * é aí que se vê se a semana foge do padrão do ano.
 */
function duasColunas(
  s: Folha, tituloA: string, tituloB: string, linhas: [string, number, number][]
): void {
  const ALTURA_LINHA = 13;
  const colA = A4.w - MARGEM - 200;
  const colB = A4.w - MARGEM - 8;

  s.avanca(12);
  s.faixa(ESQ, s.y - 15, LARGURA, 15, "primary");
  s.textoDireita(tituloA.toUpperCase(), colA, s.y - 11, { size: 7.5, bold: true, c: "surface", max: 24 });
  s.textoDireita(tituloB.toUpperCase(), colB, s.y - 11, { size: 7.5, bold: true, c: "surface", max: 24 });
  s.avanca(15);

  linhas.forEach(([rotulo, a, b], i) => {
    const y = s.y - ALTURA_LINHA;
    if (i % 2 === 1) s.faixa(ESQ, y, LARGURA, ALTURA_LINHA, "rowAlt");
    s.texto(rotulo, ESQ + 9, y + 4, { size: 8.5, max: 30 });
    s.textoDireita(eur(a), colA, y + 4, { size: 8.5 });
    s.textoDireita(eur(b), colB, y + 4, { size: 8.5, c: "muted" });
    s.avanca(ALTURA_LINHA);
  });
}

/**
 * Uma tira de rótulos e valores, repartida em partes iguais pela largura.
 *
 * O título fica ACIMA da faixa, e não dentro dela. Estava a ser desenhado antes
 * e a faixa passava-lhe por cima: no primeiro PDF gerado lia-se metade de
 * "YEAR TO DATE" a sair debaixo do fundo cinzento. Só se vê olhando para o
 * papel — o código não tinha como acusar.
 */
function tira(s: Folha, titulo: string, pares: [string, string][]): void {
  const ALTURA = 26;
  s.avanca(12);
  s.texto(titulo.toUpperCase(), ESQ, s.y, { size: 6.5, bold: true, c: "muted", max: 40 });
  s.avanca(8);

  const y = s.y - ALTURA;
  s.faixa(ESQ, y, LARGURA, ALTURA, "rowAlt");
  const largura = LARGURA / pares.length;
  pares.forEach(([k, v], i) => {
    const x = ESQ + i * largura + 9;
    s.texto(k, x, y + 16, { size: 6.5, c: "muted", max: 24 });
    s.texto(v, x, y + 5, { size: 9.5, max: 20 });
  });
  s.y = y;
}
