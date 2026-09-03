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
 * DESENHADO CONTRA O RECIBO REAL DELE, LADO A LADO
 *
 * O modelo é o payslip do Sage que o Alfredo recebe (Brulor Limited, semana 35
 * de 2026, pago a 02/09/2026), e a estrutura foi copiada de propósito:
 *
 *   · PAYMENT DETAILS e DEDUCTION DETAILS lado a lado;
 *   · os descontos com **duas colunas de valor** — THIS PERIOD e BALANCE —, e
 *     não só a do período;
 *   · a contribuição do EMPREGADOR dentro do mesmo bloco, separada por uma
 *     linha que diz o que é;
 *   · a coluna estreita da direita com GROSS PAY, TOTAL DEDS e NETT PAY;
 *   · e a faixa de baixo em três: acumulado, dados fiscais, e o que o
 *     empregador paga por cima.
 *
 * Não é imitação por imitação. Quem confere um recibo destes já o fez mil vezes
 * noutro sistema, e procura cada número no sítio onde ele sempre esteve. Mudar
 * o sítio obriga a reaprender a ler o próprio salário — e a primeira reacção a
 * um recibo que não se reconhece é achar que está errado.
 *
 * ---------------------------------------------------------------------------
 * O QUE VARIA É UMA COISA SÓ: AS HORAS
 *
 * Foi o que ele pediu, e é o que o próprio Sage faz — a coluna HOURS existe
 * sempre e vem vazia para quem é salariado. Aqui a empresa decide se ela
 * aparece (`hr_client.payslip_show_hours`), porque uma casa toda de salariados
 * não quer uma coluna vazia em todos os recibos e uma de horistas quer as horas
 * à vista. Tudo o resto é igual para toda a gente.
 *
 * ---------------------------------------------------------------------------
 * UMA PESSOA POR PÁGINA, SEMPRE
 *
 * Mesmo ao imprimir a empresa inteira num ficheiro só. Recibos de duas pessoas
 * na mesma folha acabam entregues à pessoa errada — e o que lá está é o salário
 * de alguém.
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

// ------------------------------------------------------------- a grelha
//
// Três colunas, como no recibo dele: pagamentos, descontos, e a coluna estreita
// do resumo. As larguras são fixas porque a leitura depende de os números
// caírem sempre na mesma posição vertical, recibo após recibo.
const GUTTER = 7;
const L_PAG = 196;
const L_DED = 196;
const L_RES = LARGURA - L_PAG - L_DED - GUTTER * 2;
const X_PAG = MARGEM;
const X_DED = MARGEM + L_PAG + GUTTER;
const X_RES = X_DED + L_DED + GUTTER;

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
  s.texto(p.empregador.nome, MARGEM, y, { size: 13, bold: true, c: "primary", max: 44 });
  s.textoDireita(t("payslip.title"), A4.w - MARGEM, y, { size: 16, bold: true, c: "primary" });

  y -= 11;
  if (p.empregador.registoComercial) {
    s.texto(`${t("payslip.companyReg")}: ${p.empregador.registoComercial}`, MARGEM, y,
      { size: 7.5, c: "muted", max: 50 });
  }
  const rot = rotuloDoPeriodo(p.periodo.freq, p.periodo.numero);
  s.textoDireita(`${t(rot.codigo, rot.params)} · ${p.periodo.ano}`, A4.w - MARGEM, y,
    { size: 9, bold: true, c: "text" });

  y -= 10;
  for (const l of p.empregador.linhas.slice(0, 3)) {
    s.texto(l, MARGEM, y, { size: 7, c: "muted", max: 60 });
    y -= 8.5;
  }
  s.y = y - 6;

  // ------------------------------------------- a grelha de identificação
  //
  // Duas faixas de etiqueta+valor, como as "setas" azuis do Sage. É aqui que
  // quem recebe confirma que o recibo é dele antes de olhar para os números.
  grelha(s, [
    [t("payslip.empName"), p.pessoa.nome, 2],
    [t("payslip.frequency"), p.periodo.letra, 1],
    [t("payslip.pps"), p.pessoa.pps || "—", 1],
  ]);
  grelha(s, [
    [t("payslip.staffNo"), p.pessoa.codigo || "—", 1],
    [t("payslip.role"), p.pessoa.cargo || "—", 1],
    [t("payslip.payPeriod"), String(p.periodo.numero), 1],
    [t("payslip.payDate"), dataIE(p.periodo.dataPagamento), 1],
  ]);
  s.avanca(8);

  // ------------------------------------------------------- a faixa de baixo
  //
  // Medida PRIMEIRO, porque é ela que define onde o corpo acaba.
  const cum: [string, string][] = [
    [t("payslip.grossPay"), eur(p.acumulado.brutoCents)],
    [t("payslip.taxablePay"), eur(p.acumulado.brutoCents)],
    [t("payslip.credits"), eur(p.fiscal.creditosCents)],
    [t("payslip.cutOff"), eur(p.fiscal.cutOffCents)],
    [t("payslip.taxPaid"), eur(p.acumulado.payeCents)],
  ];
  /*
   * O bloco fiscal DO PERÍODO, que é o que a pessoa reconhece.
   *
   * O crédito semanal de 76,93 está impresso no recibo dele e é por esse número
   * que alguém confere. O acumulado de 2.692,55 na semana 35 não se compara com
   * coisa nenhuma.
   */
  const fiscal: [string, string][] = [
    [t("payslip.taxStatus"), p.fiscal.estadoFiscal],
    [t("payslip.creditsTp"), eur(p.fiscal.creditosPeriodoCents)],
    [t("payslip.cutOffTp"), eur(p.fiscal.cutOffPeriodoCents)],
    [t("payslip.prsiClass"), p.fiscal.classePRSI || "—"],
    [t("payslip.insWeeks"), String(p.fiscal.semanasSeguraveis)],
  ];
  // O que a pessoa CUSTA e não recebe. Fica à parte de propósito: misturá-lo
  // com os descontos dela faria parecer que lhe saiu do salário.
  const patrao: [string, string][] = [
    [t("payslip.prsiErPeriod"), eur(p.patrao.prsiCents)],
    [t("payslip.prsiErYtd"), eur(p.acumulado.prsiEmpregadorCents)],
    [t("payslip.aeEr"), eur(p.patrao.aeCents)],
  ];

  /*
   * A FAIXA DE BAIXO fica ancorada ao FUNDO da página, e não logo a seguir ao
   * corpo.
   *
   * Um recibo é um impresso, e um impresso tem um fim. Encostada ao corpo, ela
   * deixava um terço da folha em branco por baixo e o papel parecia cortado a
   * meio — foi assim que saiu na primeira impressão. No recibo do Sage esta
   * faixa está no fundo, e é lá que quem já leu mil deles a procura.
   *
   * As três colunas são de larguras IGUAIS, e não as do corpo: "Employer PRSI
   * (to date)" não cabia na coluna estreita do resumo e o rótulo entrava pelo
   * número adentro — lia-se "Employer PRSI (to d2,490.24".
   */
  const alturaFaixa = 24 + Math.max(cum.length, fiscal.length, patrao.length) * 11;
  const yFaixa = MARGEM + 26;

  // ------------------------------------------ pagamentos, descontos, resumo
  //
  // O corpo estica-se ATÉ à faixa de baixo, com moldura. É o que o recibo do
  // Sage faz e é o que faltava ao meu: sem a moldura, um recibo de duas linhas
  // deixava meia folha em branco no meio e o papel parecia truncado. Com ela, o
  // espaço vazio lê-se como a área do impresso, que é o que é.
  const topo = s.y;
  const fundoDoCorpo = yFaixa + alturaFaixa + 16;
  const fimPag = blocoDePagamentos(s, p, t, topo);
  blocoDeDescontos(s, p, t, topo);
  blocoDeResumo(s, p, t, topo);
  s.contorno(X_PAG, fundoDoCorpo, L_PAG, topo - fundoDoCorpo, "border", 0.6);
  s.contorno(X_DED, fundoDoCorpo, L_DED, topo - fundoDoCorpo, "border", 0.6);

  /*
   * OS AVISOS SÓ SAEM NO RASCUNHO, e ficam DENTRO da coluna dos pagamentos.
   *
   * São para quem confere antes de fechar — "sem PPS", "tabela por confirmar",
   * "buraco no acumulado". Num recibo já entregue seriam ruído para quem o
   * recebe, sobre coisas que já não estão em aberto. Dentro da moldura, e não
   * soltos por baixo dela, porque soltos caíam por cima da faixa do fundo.
   */
  if (p.rascunho && p.avisos.length) {
    let ya = fimPag - 10;
    s.texto(t("payslip.warnings"), X_PAG + 6, ya, { size: 6.5, bold: true, c: "warning", max: 34 });
    ya -= 10;
    for (const a of p.avisos.slice(0, 4)) {
      ya = s.paragrafo("· " + t(a.codigo, a.params), X_PAG + 6, ya, L_PAG - 12,
        { size: 6.5, c: "warning" });
    }
  }

  const lTerco = (LARGURA - GUTTER * 2) / 3;
  colunaDeDetalhe(s, MARGEM, yFaixa, lTerco, alturaFaixa, t("payslip.cumulative"), cum);
  colunaDeDetalhe(s, MARGEM + lTerco + GUTTER, yFaixa, lTerco, alturaFaixa,
    t("payslip.taxDetails"), fiscal);
  colunaDeDetalhe(s, MARGEM + (lTerco + GUTTER) * 2, yFaixa, lTerco, alturaFaixa,
    t("payslip.employerCost"), patrao);

  // ------------------------------------------------------------- o rodapé
  s.regua(MARGEM - 8, "border", 0.6);
  s.texto(p.rascunho ? t("payslip.footerDraft") : t("payslip.footer"),
    MARGEM, MARGEM - 19, { size: 6.5, c: "muted", max: 150 });
  s.faixa(0, 0, A4.w, 5, "primary");

  // Por último, para nenhuma faixa lhe passar por cima.
  if (p.rascunho) tarjaDeRascunho(s, t);
}

// ------------------------------------------------------------------ peças

/**
 * Uma faixa de etiqueta+valor, repartida por pesos.
 *
 * São as "setas" azuis do recibo do Sage: etiqueta pequena em maiúsculas, valor
 * por baixo em corpo de leitura. O peso existe porque o nome de uma pessoa
 * precisa do dobro do espaço de uma frequência de uma letra.
 */
function grelha(s: Folha, campos: [string, string, number][]): void {
  const ALTURA = 22;
  const y = s.y - ALTURA;
  s.faixa(MARGEM, y, LARGURA, ALTURA, "rowAlt");

  const total = campos.reduce((acc, c) => acc + c[2], 0);
  let x = MARGEM;
  for (const [rotulo, valor, peso] of campos) {
    const largura = (LARGURA * peso) / total;
    s.texto(rotulo.toUpperCase(), x + 7, y + 13, { size: 5.8, c: "muted", max: 26 });
    // O `max` acompanha a largura da célula: medir com o valor por omissão
    // deixava o nome de alguém a entrar pela coluna seguinte.
    s.texto(valor, x + 7, y + 4, { size: 8.5, bold: true, max: Math.floor(largura / 4.2) });
    x += largura;
  }
  s.y = y - 3;
}

/** Cabeçalho escuro de um bloco, com as suas colunas de valor. */
function cabecalho(
  s: Folha, x: number, y: number, largura: number, titulo: string, colunas: [string, number][]
): void {
  s.faixa(x, y - 14, largura, 14, "primary");
  s.texto(titulo.toUpperCase(), x + 6, y - 10, { size: 6.8, bold: true, c: "surface", max: 24 });
  for (const [rotulo, dx] of colunas) {
    s.textoDireita(rotulo.toUpperCase(), x + dx, y - 10, { size: 5.8, bold: true, c: "surface" });
  }
}

function blocoDePagamentos(s: Folha, p: Payslip, t: Traduzir, topo: number): number {
  const colHoras = L_PAG - 118;
  const colTaxa = L_PAG - 62;
  const colValor = L_PAG - 6;
  cabecalho(s, X_PAG, topo, L_PAG, t("payslip.payments"),
    p.mostrarHoras
      ? [[t("payslip.colHours"), colHoras], [t("payslip.colRate"), colTaxa], ["EUR", colValor]]
      : [["EUR", colValor]]);

  let y = topo - 27;
  for (const l of p.pagamentos) {
    s.texto(t(l.chave), X_PAG + 6, y, { size: 8, max: 22 });
    if (p.mostrarHoras && l.horas !== null) {
      s.textoDireita(horasTexto(l.horas), X_PAG + colHoras, y, { size: 7.5, c: "muted" });
    }
    if (p.mostrarHoras && l.taxaCents !== null) {
      s.textoDireita(eur(l.taxaCents), X_PAG + colTaxa, y, { size: 7.5, c: "muted" });
    }
    // A linha de férias gozadas é informação, não pagamento: sai sem valor.
    if (l.chave !== "payslip.pay_holidayTaken") {
      s.textoDireita(eur(l.valorCents), X_PAG + colValor, y, { size: 8 });
    }
    y -= 12;
  }

  y -= 2;
  s.regua(y + 6, "border", 0.6, X_PAG, X_PAG + L_PAG);
  s.texto(t("payslip.grossPay"), X_PAG + 6, y - 4, { size: 8, bold: true, max: 22 });
  s.textoDireita(eur(p.brutoCents), X_PAG + colValor, y - 4, { size: 9, bold: true });
  return y - 12;
}

/**
 * Os descontos com DUAS colunas de valor: a do período e a do acumulado.
 *
 * É a diferença mais importante entre este recibo e o que eu tinha feito antes.
 * No recibo do Sage o acumulado está ao lado de cada desconto, e não numa
 * tabela à parte no fundo da página — assim "PAYE 53,84 / 1.755,70" lê-se de
 * uma vez, e quem confere não tem de saltar de um sítio para o outro guardando
 * o número de cabeça pelo caminho.
 */
function blocoDeDescontos(s: Folha, p: Payslip, t: Traduzir, topo: number): number {
  const colPeriodo = L_DED - 74;
  const colSaldo = L_DED - 6;
  cabecalho(s, X_DED, topo, L_DED, t("payslip.deductions"),
    [[t("payslip.colThisPeriod"), colPeriodo], [t("payslip.colBalance"), colSaldo]]);

  const linhas: [string, number, number][] = [
    [t("payslip.paye"), p.descontos.payeCents, p.acumulado.payeCents],
    [t("payslip.prsi"), p.descontos.prsiCents, p.acumulado.prsiCents],
    [t("payslip.usc"), p.descontos.uscCents, p.acumulado.uscCents],
  ];
  if (p.descontos.aeCents || p.acumulado.aeCents) {
    linhas.push([t("payslip.ae"), p.descontos.aeCents, p.acumulado.aeCents]);
  }

  let y = topo - 27;
  for (const [rotulo, periodo, saldo] of linhas) {
    s.texto(rotulo, X_DED + 6, y, { size: 8, max: 22 });
    s.textoDireita(eur(periodo), X_DED + colPeriodo, y, { size: 8 });
    s.textoDireita(eur(saldo), X_DED + colSaldo, y, { size: 8, c: "muted" });
    y -= 12;
  }

  /*
   * A CONTRIBUIÇÃO DO EMPREGADOR, com a linha que diz o que é.
   *
   * O Sage escreve "--Employer Pension Contribution---" e repete a linha da AE
   * por baixo. Sem esse aviso, um segundo "AE Pension 9,81" logo a seguir ao
   * primeiro lê-se como se tivesse sido descontado duas vezes — e é a primeira
   * coisa que alguém traz de volta ao balcão.
   */
  if (p.patrao.aeCents) {
    y -= 3;
    s.texto("— " + t("payslip.employerContribution"), X_DED + 6, y,
      { size: 6.2, c: "muted", max: 44 });
    y -= 11;
    s.texto(t("payslip.ae"), X_DED + 6, y, { size: 8, c: "muted", max: 22 });
    s.textoDireita(eur(p.patrao.aeCents), X_DED + colPeriodo, y, { size: 8, c: "muted" });
    s.textoDireita(eur(p.acumulado.aeCents), X_DED + colSaldo, y, { size: 8, c: "muted" });
    y -= 12;
  }

  y -= 2;
  s.regua(y + 6, "border", 0.6, X_DED, X_DED + L_DED);
  s.texto(t("payslip.totalDeductions"), X_DED + 6, y - 4, { size: 8, bold: true, max: 24 });
  const total = p.descontos.payeCents + p.descontos.uscCents
    + p.descontos.prsiCents + p.descontos.aeCents;
  s.textoDireita(eur(total), X_DED + colSaldo, y - 4, { size: 9, bold: true });
  return y - 12;
}

/** A coluna estreita da direita: bruto, descontos, líquido. */
function blocoDeResumo(s: Folha, p: Payslip, t: Traduzir, topo: number): number {
  cabecalho(s, X_RES, topo, L_RES, t("payslip.summary"), []);

  const total = p.descontos.payeCents + p.descontos.uscCents
    + p.descontos.prsiCents + p.descontos.aeCents;

  let y = topo - 14;
  const caixa = (rotulo: string, valor: string, destaque = false) => {
    const ALTURA = destaque ? 40 : 32;
    const yc = y - ALTURA;
    s.faixa(X_RES, yc, L_RES, ALTURA, destaque ? "primary" : "rowAlt");
    s.texto(rotulo.toUpperCase(), X_RES + 7, yc + ALTURA - 12,
      { size: 5.8, bold: true, c: destaque ? "surface" : "muted", max: 22 });
    s.textoDireita(valor, X_RES + L_RES - 7, yc + 8,
      { size: destaque ? 13 : 11, bold: true, c: destaque ? "surface" : "text" });
    y = yc - 4;
  };

  caixa(t("payslip.grossPay"), eur(p.brutoCents));
  caixa(t("payslip.totalDeductions"), eur(total));
  // O líquido é o número que a pessoa procura primeiro. Fica em caixa escura, e
  // é o maior da página.
  caixa(t("payslip.netPay"), eur(p.liquidoCents), true);

  return y;
}

/** Uma coluna da faixa de baixo: título e pares de etiqueta/valor. */
function colunaDeDetalhe(
  s: Folha, x: number, y: number, largura: number, altura: number,
  titulo: string, pares: [string, string][]
): void {
  s.contorno(x, y, largura, altura, "border", 0.6);
  s.faixa(x, y + altura - 13, largura, 13, "accentSoft");
  s.texto(titulo.toUpperCase(), x + 6, y + altura - 9,
    { size: 5.8, bold: true, c: "primary", max: 30 });

  let yl = y + altura - 24;
  for (const [rotulo, valor] of pares) {
    s.texto(rotulo, x + 6, yl, { size: 6.5, c: "muted", max: 26 });
    s.textoDireita(valor, x + largura - 6, yl, { size: 7.5, max: 18 });
    yl -= 11;
  }
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
