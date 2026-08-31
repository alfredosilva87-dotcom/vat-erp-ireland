import "server-only";
import ExcelJS from "exceljs";
import type { Comparativo, Kpi } from "@/lib/accounting/comparative";
import type { LinhaDeRelatorio } from "@/lib/accounting/reports";
import { C, FORMATO_MOEDA, moeda, variacaoTexto } from "@/lib/reportBrand";
import {
  A4, LARGURA, MARGEM, Folha, blocosDeAssinatura, cartoesKpi, colunaDireita,
  faixaDeSecao, graficoBarras, graficoLinha, linhaDeTabela, rodape, timbre,
  tituloDoRelatorio,
} from "@/lib/accounting/pdfKit";
import { MARCA } from "@/lib/marca";

/**
 * As demonstrações em PDF e em Excel, no papel do escritório.
 *
 * Os dois partem do MESMO objeto que a tela recebe — nenhum deles refaz uma
 * soma. Se o PDF discordar da tela é bug de formatação, nunca de número, e
 * isso reduz muito o que há para investigar quando um contabilista diz "o
 * papel não bate com o sistema".
 *
 * ---------------------------------------------------------------------------
 * DUAS VISÕES, e não uma a substituir a outra
 *
 *   ENXUTA   — só as demonstrações. É a cópia de trabalho, para conferir
 *              número e cruzar com o balancete.
 *   COMPLETA — com a coluna do ano anterior, os cartões de KPI e os gráficos.
 *              É a que vai para a mão do cliente.
 *
 * ---------------------------------------------------------------------------
 * O FORMATO É VERTICAL, e é de propósito
 *
 * A referência mostra o balanço em duas colunas lado a lado (ATIVO | PASSIVO),
 * que é o modelo brasileiro. O Schedule 3A do Companies Act 2014 é VERTICAL:
 * chega-se ao ativo líquido e prova-se contra capital e reservas. Copia-se
 * dela o desenho — timbre, faixas, colunas comparativas, cartões, gráficos —
 * e não o arranjo das rubricas, que aqui é o que a lei manda.
 */

const anoDe = (iso: string) => iso.slice(0, 4);
const fimDoPeriodo = (iso: string) => iso.split("-").reverse().join("/");

// ==================================================================== PDF

export async function buildAccountingPdf(c: Comparativo) {
  const s = await Folha.criar();
  const e = c.escritorio;
  const comparativo = c.anterior !== null;
  const colunas = comparativo ? 2 : 1;
  const cabecalhos = comparativo
    ? [fimDoPeriodo(c.atual.to), fimDoPeriodo(c.anterior!.to)]
    : [fimDoPeriodo(c.atual.to)];

  s.aoAbrirPagina((folha) => timbre(folha, {
    firma: e?.name || "",
    linhas: [
      e?.address || "",
      [e?.phone, e?.website].filter(Boolean).join("  -  "),
      e?.contact_email || "",
    ].filter(Boolean),
    cliente: c.atual.client?.name || "",
    identificacao: [
      c.atual.client?.cro ? `CRO ${c.atual.client.cro}` : "",
      c.atual.client?.vat_number ? `VAT ${c.atual.client.vat_number}` : "",
      c.atual.client?.client_code || "",
    ].filter(Boolean),
  }));
  s.novaPagina();

  // ---- aviso de fechamento, antes de tudo ----
  if (!c.atual.balances) {
    s.faixa(MARGEM, s.y - 16, LARGURA, 18, "dangerSoft");
    s.texto(
      `BALANCE SHEET DOES NOT BALANCE - difference ${moeda(c.atual.difference)}`,
      MARGEM + 9, s.y - 10, { size: 8.5, bold: true, c: "danger", max: 70 }
    );
    s.avanca(26);
  }

  // ---- DRE ----
  tituloDoRelatorio(s,
    "Profit and loss account",
    `For the financial year ended ${fimDoPeriodo(c.atual.to)}`,
    "Amounts in EUR - Schedule 3A, Companies Act 2014");

  avisoDeAnoCorrente(s, c);

  if (c.visao === "completa" && c.kpis.length > 0) {
    cartoesKpi(s, c.kpis.map((k) => ({
      label: k.label,
      valor: k.formato === "pct" ? `${k.valor.toFixed(1)}%` : moeda(k.valor, 0),
      variacao: k.variacao, emPontos: k.variacaoEmPontos, nota: k.nota,
    })));
  }

  demonstracao(s, "Profit and loss account", cabecalhos, c.atual.profitAndLoss,
    comparativo ? c.anterior!.profitAndLoss : null, colunas, comparativo);

  // ---- gráficos ----
  if (c.visao === "completa" && c.serie.length > 1) {
    s.espaco(150);
    s.avanca(20);
    const largura = (LARGURA - 14) / 2;
    const altura = 104;
    const y = s.y - altura;
    graficoBarras(s, MARGEM, y, largura, altura, "Turnover by year",
      c.serie.map((p) => ({ rotulo: String(p.ano), valor: p.turnover })));
    graficoBarras(s, MARGEM + largura + 14, y, largura, altura, "Profit by year",
      c.serie.map((p) => ({ rotulo: String(p.ano), valor: p.profit })), "primaryMed");
    s.y = y - 18;

    s.espaco(130);
    const y2 = s.y - altura;
    graficoLinha(s, MARGEM, y2, LARGURA, altura, "Net margin by year",
      c.serie.map((p) => ({ rotulo: String(p.ano), valor: p.margem })));
    s.y = y2 - 16;
  }

  // ---- Balanço ----
  s.novaPagina();
  tituloDoRelatorio(s,
    "Balance sheet",
    `As at ${fimDoPeriodo(c.atual.to)}`,
    "Amounts in EUR - Schedule 3A, Companies Act 2014");

  demonstracao(s, "Balance sheet", cabecalhos, c.atual.balanceSheet,
    comparativo ? c.anterior!.balanceSheet : null, colunas, comparativo);

  s.espaco(40);
  s.avanca(8);
  // A frase anterior prometia "notes on the following pages", e paginas de
  // notas explicativas este relatorio nao produz. Prometer anexo que nao
  // existe num documento que vai ao CRO e pior do que nao dizer nada.
  s.texto(
    "Prepared in accordance with Schedule 3A of the Companies Act 2014.",
    MARGEM, s.y, { size: 7.5, c: "muted", max: 110 }
  );
  s.avanca(6);

  blocosDeAssinatura(s,
    { nome: e?.signer_name || "", papel: [e?.signer_title || "Accountant", e?.registration_no].filter(Boolean).join("  -  ") },
    { nome: "", papel: "Director, for and on behalf of the board" });

  // ---- Balancete ----
  s.novaPagina();
  tituloDoRelatorio(s, "Trial balance",
    `As at ${fimDoPeriodo(c.atual.to)}`, "Amounts in EUR");
  faixaDeSecao(s, "Account", ["Debit", "Credit"]);

  let d = 0, cr = 0;
  c.atual.trialBalance.forEach((conta, i) => {
    linhaDeTabela(s, {
      label: `${conta.account_code}   ${conta.account_name}`,
      valores: [
        conta.side === "debit" ? conta.balance : null,
        conta.side === "credit" ? conta.balance : null,
      ],
    }, 2, i % 2 === 1);
    if (conta.side === "debit") d += conta.balance; else cr += conta.balance;
  });
  linhaDeTabela(s, {
    label: "TOTAL", valores: [Math.round(d * 100) / 100, Math.round(cr * 100) / 100], total: true,
  }, 2);

  // ---- rodapé em todas as páginas ----
  const nota = e?.name
    ? `Prepared by ${e.name}${e.registration_no ? ` (${e.registration_no})` : ""}`
    : "";
  s.pdf.getPages().forEach((pagina, i) => {
    s.pagina = pagina;
    rodape(s, nota, i + 1);
  });

  return s.bytes();
}

/**
 * O aviso de exercício em curso.
 *
 * Um ano que ainda corre tem oito meses de movimento e é comparado com doze do
 * ano anterior. A faturação aparece a cair trinta por cento, e a queda é do
 * calendário e não da empresa — quem recebe a folha não tem como saber disso,
 * e a leitura errada é a natural. Então diz-se, por cima da tabela, onde não
 * se pode não ver.
 *
 * O aviso sai quando o exercício é o ano corrente. Um relatório de um ano
 * fechado não o leva, porque ali a comparação é mesmo de doze contra doze.
 */
function avisoDeAnoCorrente(s: Folha, c: Comparativo): void {
  const ate = emCurso(c);
  if (!ate) return;
  s.faixa(MARGEM, s.y - 12, LARGURA, 16, "warningSoft");
  s.texto(
    `Financial year in progress - ${anoDe(c.atual.from)} figures cover the period to ${fimDoPeriodo(ate)}, `
    + "compared with a full twelve months.",
    MARGEM + 9, s.y - 7, { size: 7.5, bold: true, c: "warning", max: 120 }
  );
  s.avanca(24);
}

/**
 * O exercício ainda corre? Devolve a data do último lançamento, ou nulo.
 *
 * O corte é a última data COM LANÇAMENTO e não a data de hoje. Duas razões, e
 * as duas já morderam: `new Date().toISOString()` devolve a data em UTC, que
 * na Irlanda está uma hora à frente no verão — entre a meia-noite e a uma da
 * manhã o relatório saía datado do dia anterior. E "até hoje" é falso quando
 * o último documento entrou há três semanas: o leitor merece saber até onde o
 * papel tem dado, não em que dia foi impresso.
 */
function emCurso(c: Comparativo): string | null {
  if (c.anterior === null) return null;
  const ultima = c.atual.lastPosting;
  // Sem lançamento nenhum não há o que avisar; e um exercício cujo último
  // lançamento é 31/12 está completo, ou tão perto que o aviso enganaria.
  if (!ultima || ultima >= c.atual.to) return null;
  return ultima;
}

/** Uma demonstração inteira: faixa, linhas e a coluna de variação. */
function demonstracao(
  s: Folha, titulo: string, cabecalhos: string[],
  atual: LinhaDeRelatorio[], anterior: LinhaDeRelatorio[] | null,
  colunas: number, comVariacao: boolean
): void {
  /*
   * A coluna de variacao CONTA como coluna na grelha.
   *
   * Enquanto o cabecalho tinha tres rotulos e as linhas duas colunas, cada um
   * media a largura com um total diferente: os numeros saiam uma coluna a
   * direita do rotulo deles, e a coluna do ano corrente aparecia vazia — com
   * os valores todos certos, o que torna o erro dificil de ver e facil de
   * assinar.
   */
  const grelha = comVariacao ? colunas + 1 : colunas;
  faixaDeSecao(s, titulo, comVariacao ? [...cabecalhos, "VAR."] : cabecalhos);

  const antes = new Map((anterior ?? []).map((l) => [l.key, l.amount]));
  atual.forEach((l, i) => {
    const previo = anterior ? (antes.get(l.key) ?? 0) : null;
    linhaDeTabela(s, {
      label: l.label,
      valores: colunas === 2 ? [l.amount, previo] : [l.amount],
      destaque: l.computed, nivel: l.level,
      texto: comVariacao ? variacaoTexto(percentual(l.amount, previo)) : undefined,
    }, grelha, !l.computed && i % 2 === 1);
  });
}

/**
 * A variação entre dois valores de rubrica, medida na GRANDEZA.
 *
 * O sinal com que uma despesa aparece no relatório é convenção de
 * apresentação — "Cost of sales (247.163,15)" —, não a direção do que
 * aconteceu. Comparar os números com sinal faz um custo que caiu de 362.876
 * para 247.163 imprimir "+31,9%", porque ficou menos negativo. Ao lado da
 * palavra "cost", isso lê-se como um aumento de trinta por cento: o contrário
 * exato do que a empresa fez, num sítio onde ninguém vai conferir a conta.
 *
 * Comparadas as grandezas, o mesmo custo imprime "-31,9%" e lê-se "caiu".
 *
 * Nulo quando a base é zero ou quando a rubrica trocou de sinal: aí não há
 * percentagem que se leia bem, e os dois valores ao lado dizem melhor.
 */
function percentual(atual: number, anterior: number | null): number | null {
  if (anterior === null || anterior === 0) return null;
  if (Math.sign(atual) !== Math.sign(anterior) && atual !== 0) return null;
  const de = Math.abs(anterior);
  return Math.round(((Math.abs(atual) - de) / de) * 1000) / 10;
}

// ================================================================== EXCEL

export async function buildAccountingWorkbook(c: Comparativo) {
  const wb = new ExcelJS.Workbook();
  wb.creator = c.escritorio?.name || MARCA.nome;
  wb.created = new Date();
  const comparativo = c.anterior !== null;

  if (c.visao === "completa") painelExcel(wb, c);
  folhaDeDemonstracao(wb, c, "Profit and loss", c.atual.profitAndLoss,
    comparativo ? c.anterior!.profitAndLoss : null);
  folhaDeDemonstracao(wb, c, "Balance sheet", c.atual.balanceSheet,
    comparativo ? c.anterior!.balanceSheet : null);
  folhaDeBalancete(wb, c);

  /*
   * `Uint8Array.from` e nao um cast: o buffer que o ExcelJS devolve vem tipado
   * como `ArrayBufferLike`, que pode ser memoria partilhada e por isso o
   * TypeScript recusa como corpo de resposta. Copiar produz um `ArrayBuffer`
   * comum. Um cast calaria o compilador sem resolver o que ele esta a apontar.
   */
  return Uint8Array.from(new Uint8Array(await wb.xlsx.writeBuffer()));
}

/** O timbre no topo de cada aba. */
function timbreExcel(ws: ExcelJS.Worksheet, c: Comparativo, titulo: string, colunas: number): void {
  const e = c.escritorio;
  ws.mergeCells(1, 1, 1, colunas);
  const t = ws.getCell(1, 1);
  t.value = `${e?.name ?? ""}${e?.name ? "   |   " : ""}${c.atual.client?.name ?? ""}`;
  t.font = { bold: true, size: 14, color: { argb: C.surface } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
  t.alignment = { vertical: "middle" };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, colunas);
  const sub = ws.getCell(2, 1);
  const id = [
    c.atual.client?.cro && `CRO ${c.atual.client.cro}`,
    c.atual.client?.vat_number && `VAT ${c.atual.client.vat_number}`,
  ].filter(Boolean).join("   ");
  sub.value = `${titulo}   |   ${fimDoPeriodo(c.atual.to)}   |   Amounts in EUR   ${id}`;
  sub.font = { size: 9, color: { argb: C.muted } };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.bg } };
  ws.getRow(2).height = 18;

  if (!c.atual.balances) {
    ws.mergeCells(3, 1, 3, colunas);
    const aviso = ws.getCell(3, 1);
    aviso.value = `BALANCE SHEET DOES NOT BALANCE — difference ${moeda(c.atual.difference)}`;
    aviso.font = { bold: true, size: 10, color: { argb: C.danger } };
    aviso.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.dangerSoft } };
  } else if (emCurso(c)) {
    // O mesmo aviso do PDF: oito meses comparados com doze parecem uma queda.
    ws.mergeCells(3, 1, 3, colunas);
    const aviso = ws.getCell(3, 1);
    aviso.value = `Financial year in progress — ${c.ano} figures cover the period to `
      + `${fimDoPeriodo(emCurso(c)!)}, compared with a full twelve months.`;
    aviso.font = { bold: true, size: 9, color: { argb: C.warning } };
    aviso.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.warningSoft } };
  }
}

/** O painel: cartões de KPI e as séries com barra na célula. */
function painelExcel(wb: ExcelJS.Workbook, c: Comparativo): void {
  const ws = wb.addWorksheet("Dashboard", { properties: { tabColor: { argb: C.primary } } });
  ws.views = [{ showGridLines: false }];
  ws.columns = [{ width: 3 }, ...Array.from({ length: 12 }, () => ({ width: 11 }))];
  timbreExcel(ws, c, "Dashboard", 13);

  // ---- cartões ----
  let col = 2;
  for (const k of c.kpis) {
    cartaoExcel(ws, col, 5, k);
    col += 3;
  }

  /*
   * As séries entram como TABELA com barra na célula, e não como gráfico.
   *
   * O ExcelJS não escreve gráficos — não tem API para isso, e colar uma
   * imagem daria um "gráfico" que não se atualiza e não se aproveita. A barra
   * de dados é nativa do Excel: quem receber o ficheiro pode selecionar as
   * colunas e inserir o gráfico que quiser em dois cliques, sobre os números
   * que já estão lá. O PDF, esse, leva os gráficos desenhados de verdade.
   */
  const inicio = 12;
  ws.getCell(inicio, 2).value = "By financial year";
  ws.getCell(inicio, 2).font = { bold: true, size: 12, color: { argb: C.primaryMed } };

  const cabecalho = ws.getRow(inicio + 1);
  ["Year", "Turnover", "Gross profit", "Profit", "Net margin %"].forEach((h, i) => {
    const cel = cabecalho.getCell(2 + i);
    cel.value = h;
    cel.font = { bold: true, size: 10, color: { argb: C.surface } };
    cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
    cel.alignment = { horizontal: i === 0 ? "left" : "right" };
  });

  c.serie.forEach((p, i) => {
    const linha = ws.getRow(inicio + 2 + i);
    linha.getCell(2).value = p.ano;
    ([p.turnover, p.grossProfit, p.profit, p.margem] as number[]).forEach((v, j) => {
      const cel = linha.getCell(3 + j);
      cel.value = v;
      cel.numFmt = j === 3 ? '0.0"%"' : FORMATO_MOEDA;
    });
    if (i % 2 === 1) linha.eachCell((cel) => {
      cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.rowAlt } };
    });
  });

  const primeira = inicio + 2, ultima = inicio + 1 + c.serie.length;
  for (const coluna of ["C", "D", "E"]) {
    ws.addConditionalFormatting({
      ref: `${coluna}${primeira}:${coluna}${ultima}`,
      // O `cfvo` nao e opcional apesar de o tipo o dar como tal: sem ele o
      // ExcelJS rebenta ao escrever a regra, e o pedido inteiro devolve 500
      // sem dizer que foi a barra de dados.
      rules: [{
        type: "dataBar", priority: 1, minLength: 0, maxLength: 100,
        cfvo: [{ type: "min" }, { type: "max" }],
        color: { argb: C.accent },
      } as any],
    });
  }
}

function cartaoExcel(ws: ExcelJS.Worksheet, col: number, linha: number, k: Kpi): void {
  ws.mergeCells(linha, col, linha, col + 1);
  const rotulo = ws.getCell(linha, col);
  rotulo.value = k.label;
  rotulo.font = { size: 9, color: { argb: C.muted } };
  rotulo.border = { top: { style: "medium", color: { argb: C.accent } } };

  ws.mergeCells(linha + 1, col, linha + 2, col + 1);
  const valor = ws.getCell(linha + 1, col);
  valor.value = k.formato === "pct" ? k.valor / 100 : k.valor;
  valor.numFmt = k.formato === "pct" ? "0.0%" : FORMATO_MOEDA;
  valor.font = { bold: true, size: 20, color: { argb: C.accent } };
  valor.alignment = { vertical: "middle" };

  ws.mergeCells(linha + 3, col, linha + 3, col + 1);
  const variacao = ws.getCell(linha + 3, col);
  // A nota tem prioridade sobre a percentagem, e sobre o "sem comparativo":
  // um resultado que virou prejuizo TEM comparativo — o que nao tem e uma
  // percentagem que se leia.
  variacao.value = k.nota ?? (k.variacao === null
    ? "no comparative"
    : `${variacaoTexto(k.variacao, k.variacaoEmPontos)} vs prior year`);
  variacao.font = {
    size: 9, bold: k.nota != null || k.variacao !== null,
    color: {
      argb: k.nota ? C.danger
        : k.variacao === null ? C.muted
        : k.variacao >= 0 ? C.success : C.danger,
    },
  };
}

/** DRE ou balanço, com a coluna do ano anterior e a variação. */
function folhaDeDemonstracao(
  wb: ExcelJS.Workbook, c: Comparativo, titulo: string,
  atual: LinhaDeRelatorio[], anterior: LinhaDeRelatorio[] | null
): void {
  const ws = wb.addWorksheet(titulo, { properties: { tabColor: { argb: C.accent } } });
  const colunas = anterior ? 4 : 2;
  ws.columns = anterior
    ? [{ width: 54 }, { width: 16 }, { width: 16 }, { width: 11 }]
    : [{ width: 54 }, { width: 16 }];
  timbreExcel(ws, c, titulo, colunas);
  ws.addRow([]);

  const cabecalho = ws.addRow(anterior
    ? ["", fimDoPeriodo(c.atual.to), fimDoPeriodo(c.anterior!.to), "VAR. %"]
    : ["", fimDoPeriodo(c.atual.to)]);
  cabecalho.font = { bold: true, color: { argb: C.surface } };
  cabecalho.eachCell((cel) => {
    cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
    cel.alignment = { horizontal: "right" };
  });
  cabecalho.getCell(1).alignment = { horizontal: "left" };
  ws.views = [{ state: "frozen", ySplit: cabecalho.number }];

  const antes = new Map((anterior ?? []).map((l) => [l.key, l.amount]));
  for (const l of atual) {
    const previo = anterior ? (antes.get(l.key) ?? 0) : null;
    const pct = percentual(l.amount, previo);
    const linha = ws.addRow(anterior
      ? [l.label, l.amount, previo, pct === null ? "—" : pct / 100]
      : [l.label, l.amount]);
    linha.getCell(2).numFmt = FORMATO_MOEDA;
    if (anterior) {
      linha.getCell(3).numFmt = FORMATO_MOEDA;
      if (pct !== null) {
        linha.getCell(4).numFmt = "+0.0%;-0.0%";
        linha.getCell(4).font = { color: { argb: pct >= 0 ? C.success : C.danger } };
      }
    }
    if (l.computed) {
      linha.font = { bold: true };
      linha.eachCell((cel) => {
        cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.accentSoft } };
      });
    }
    if (l.level) linha.getCell(1).alignment = { indent: l.level * 2 };
  }

  const assinatura = c.escritorio?.name
    ? `Prepared by ${c.escritorio.name}${c.escritorio.registration_no ? ` (${c.escritorio.registration_no})` : ""}`
    : "";
  if (assinatura) {
    ws.addRow([]);
    const nota = ws.addRow([assinatura]);
    nota.font = { size: 9, italic: true, color: { argb: C.muted } };
  }
}

function folhaDeBalancete(wb: ExcelJS.Workbook, c: Comparativo): void {
  const ws = wb.addWorksheet("Trial balance", { properties: { tabColor: { argb: C.accent } } });
  ws.columns = [{ width: 12 }, { width: 42 }, { width: 14 }, { width: 16 }, { width: 16 }];
  timbreExcel(ws, c, "Trial balance", 5);
  ws.addRow([]);

  const cabecalho = ws.addRow(["Code", "Account", "Type", "Debit", "Credit"]);
  cabecalho.font = { bold: true, color: { argb: C.surface } };
  cabecalho.eachCell((cel) => {
    cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
  });
  ws.views = [{ state: "frozen", ySplit: cabecalho.number }];

  let d = 0, cr = 0;
  c.atual.trialBalance.forEach((conta, i) => {
    const linha = ws.addRow([
      conta.account_code, conta.account_name, conta.type,
      conta.side === "debit" ? conta.balance : null,
      conta.side === "credit" ? conta.balance : null,
    ]);
    linha.getCell(4).numFmt = FORMATO_MOEDA;
    linha.getCell(5).numFmt = FORMATO_MOEDA;
    if (i % 2 === 1) linha.eachCell((cel) => {
      cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.rowAlt } };
    });
    if (conta.side === "debit") d += conta.balance; else cr += conta.balance;
  });

  const total = ws.addRow(["", "TOTAL", "", Math.round(d * 100) / 100, Math.round(cr * 100) / 100]);
  total.font = { bold: true, color: { argb: C.surface } };
  total.eachCell((cel) => {
    cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primaryMed } };
  });
  total.getCell(4).numFmt = FORMATO_MOEDA;
  total.getCell(5).numFmt = FORMATO_MOEDA;
}

export { anoDe };
