import "server-only";
import ExcelJS from "exceljs";
import type { Timbre } from "@/lib/accounting/comparative";
import type { ContaDoRazao, Razao } from "@/lib/accounting/ledger";
import { C, FORMATO_MOEDA, moeda } from "@/lib/reportBrand";
import {
  A4, LARGURA, MARGEM, Folha, rodape, timbre, tituloDoRelatorio,
} from "@/lib/accounting/pdfKit";

/**
 * O razão em PDF e em Excel — o mesmo papel timbrado das demonstrações.
 *
 * Sai da MESMA `loadLedger` que monta a tela, e imprime exatamente as contas
 * que a pessoa escolheu lá. Um export que traz o razão inteiro quando se
 * pediram três contas não é um export a mais: é a folha errada em cima da
 * mesa na reunião de conciliação.
 */

const data = (iso: string) => iso.split("-").reverse().join("/");

// ==================================================================== PDF

/** As colunas do razão, em pontos. Fixas: um razão é uma grade. */
const COL = {
  data: MARGEM + 8,
  doc: MARGEM + 62,
  historico: MARGEM + 140,
  debito: MARGEM + 366,
  credito: MARGEM + 434,
  saldo: A4.w - MARGEM - 8,
};

export async function buildLedgerPdf(r: Razao, e: Timbre | null) {
  const s = await Folha.criar();

  s.aoAbrirPagina((folha) => timbre(folha, {
    firma: e?.name || "",
    linhas: [
      e?.address || "",
      [e?.phone, e?.website].filter(Boolean).join("  -  "),
      e?.contact_email || "",
    ].filter(Boolean),
    cliente: r.client?.name || "",
    identificacao: [
      r.client?.cro ? `CRO ${r.client.cro}` : "",
      r.client?.vat_number ? `VAT ${r.client.vat_number}` : "",
      r.client?.client_code || "",
    ].filter(Boolean),
  }));
  s.novaPagina();

  tituloDoRelatorio(s, "General ledger",
    `Period from ${data(r.from)} to ${data(r.to)}`,
    `Amounts in EUR - ${r.accounts.length} account${r.accounts.length === 1 ? "" : "s"} selected`);

  for (const conta of r.accounts) contaEmPdf(s, conta);

  // ---- total da seleção ----
  s.espaco(30);
  s.avanca(6);
  const y = s.y - 20;
  s.faixa(MARGEM, y, LARGURA, 20, "primaryMed");
  s.texto(`TOTAL - ${r.accounts.length} account(s)`, COL.data, y + 6.5,
    { size: 9, bold: true, c: "surface", max: 40 });
  s.textoDireita(moeda(r.totals.debit), COL.debito, y + 6.5, { size: 9, bold: true, c: "surface" });
  s.textoDireita(moeda(r.totals.credit), COL.credito, y + 6.5, { size: 9, bold: true, c: "surface" });
  s.textoDireita(moeda(r.totals.closing), COL.saldo, y + 6.5, { size: 9, bold: true, c: "surface" });
  s.y = y - 8;

  /*
   * O aviso de que débito e crédito não fecham entre si numa seleção parcial.
   *
   * Sem ele, quem imprime três contas e vê os totais diferentes conclui que o
   * razão está torto. A contrapartida de cada lançamento está noutra conta,
   * que pode não ter sido escolhida — é assim que tem de ser, e é preciso
   * dizê-lo no papel, porque o papel sai da sala sem quem o gerou.
   */
  s.espaco(34);
  // `paragrafo` e nao `texto`: a frase tem 200 caracteres e o `texto` cortava-a
  // a meio da palavra, deixando o papel a acabar em "...was not selec".
  s.paragrafo(
    "Debit and credit totals of a partial selection do not agree with each other: "
    + "the contra entry of each posting may sit in an account that was not selected. "
    + "Use the trial balance to prove the ledger.",
    MARGEM, s.y - 4, LARGURA, { size: 7, c: "muted" }
  );

  const nota = e?.name
    ? `Prepared by ${e.name}${e.registration_no ? ` (${e.registration_no})` : ""}`
    : "";
  s.pdf.getPages().forEach((pagina, i) => {
    s.pagina = pagina;
    rodape(s, nota, i + 1);
  });

  return s.bytes();
}

/** Uma conta: faixa com o código, saldo anterior, lançamentos e fecho. */
function contaEmPdf(s: Folha, conta: ContaDoRazao): void {
  // A faixa da conta e o saldo anterior nunca se separam do que vem abaixo:
  // uma conta cujo cabeçalho ficou no pé da página anterior obriga a folhear
  // para trás para saber de que conta é a linha que se está a ler.
  s.espaco(74);

  const yFaixa = s.y - 20;
  s.faixa(MARGEM, yFaixa, LARGURA, 20, "primary");
  s.texto(`${conta.code}   ${conta.name}`, COL.data, yFaixa + 6.5,
    { size: 9.5, bold: true, c: "surface", max: 44 });
  s.textoDireita("Debit", COL.debito, yFaixa + 6.5, { size: 7.5, bold: true, c: "surface" });
  s.textoDireita("Credit", COL.credito, yFaixa + 6.5, { size: 7.5, bold: true, c: "surface" });
  s.textoDireita("Balance", COL.saldo, yFaixa + 6.5, { size: 7.5, bold: true, c: "surface" });
  s.y = yFaixa - 1;

  linhaDoRazao(s, {
    esquerda: "Opening balance",
    saldo: conta.opening, destaque: true,
  });

  conta.entries.forEach((e, i) => {
    linhaDoRazao(s, {
      data: data(e.date),
      doc: e.documentRef || e.sourceModule,
      historico: e.counterparty || e.description || "",
      debito: e.debit || null,
      credito: e.credit || null,
      saldo: e.balance,
      zebra: i % 2 === 1,
    });
  });

  if (conta.entries.length === 0) {
    s.espaco(14);
    s.texto("No movement in the period", COL.historico, s.y - 10, { size: 8, c: "muted", max: 40 });
    s.y -= 14;
  }

  linhaDoRazao(s, {
    esquerda: "Movement and closing balance",
    debito: conta.debit, credito: conta.credit, saldo: conta.closing,
    total: true,
  });
  s.avanca(12);
}

type LinhaRazao = {
  data?: string; doc?: string; historico?: string;
  esquerda?: string;
  debito?: number | null; credito?: number | null; saldo: number;
  destaque?: boolean; total?: boolean; zebra?: boolean;
};

function linhaDoRazao(s: Folha, l: LinhaRazao): void {
  const ALTURA = l.total ? 17 : 13;
  s.espaco(ALTURA);
  const y = s.y - ALTURA;
  const base = y + (l.total ? 5.5 : 4);

  if (l.total) s.faixa(MARGEM, y, LARGURA, ALTURA, "primaryMed");
  else if (l.destaque) s.faixa(MARGEM, y, LARGURA, ALTURA, "accentSoft");
  else if (l.zebra) s.faixa(MARGEM, y, LARGURA, ALTURA, "rowAlt");

  const tinta = l.total ? "surface" : "text";
  const size = l.total ? 8.5 : 8;
  const bold = Boolean(l.total || l.destaque);

  if (l.esquerda) {
    s.texto(l.esquerda, COL.data, base, { size, bold, c: tinta, max: 46 });
  } else {
    s.texto(l.data ?? "", COL.data, base, { size, c: tinta, max: 10 });
    s.texto(l.doc ?? "", COL.doc, base, { size, c: l.total ? "surface" : "muted", max: 15 });
    s.texto(l.historico ?? "", COL.historico, base, { size, c: tinta, max: 40 });
  }

  if (l.debito != null) s.textoDireita(moeda(l.debito), COL.debito, base, { size, bold, c: tinta });
  if (l.credito != null) s.textoDireita(moeda(l.credito), COL.credito, base, { size, bold, c: tinta });
  s.textoDireita(moeda(l.saldo), COL.saldo, base, { size, bold: true, c: tinta });

  s.y = y;
}

// ================================================================== EXCEL

export async function buildLedgerWorkbook(r: Razao, e: Timbre | null) {
  const wb = new ExcelJS.Workbook();
  wb.creator = e?.name || "VAT Reader";
  wb.created = new Date();

  folhaAgrupada(wb, r, e);
  folhaPlana(wb, r, e);

  return Uint8Array.from(new Uint8Array(await wb.xlsx.writeBuffer()));
}

function cabecalhoExcel(ws: ExcelJS.Worksheet, r: Razao, e: Timbre | null, titulo: string, colunas: number): void {
  ws.mergeCells(1, 1, 1, colunas);
  const t = ws.getCell(1, 1);
  t.value = `${e?.name ?? ""}${e?.name ? "   |   " : ""}${r.client?.name ?? ""}`;
  t.font = { bold: true, size: 14, color: { argb: C.surface } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
  t.alignment = { vertical: "middle" };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, colunas);
  const sub = ws.getCell(2, 1);
  sub.value = `${titulo}   |   ${data(r.from)} a ${data(r.to)}   |   Amounts in EUR   |   `
    + `${r.accounts.length} account(s) selected`;
  sub.font = { size: 9, color: { argb: C.muted } };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.bg } };
}

/** O razão como se lê no papel: conta a conta, com saldo anterior e fecho. */
function folhaAgrupada(wb: ExcelJS.Workbook, r: Razao, e: Timbre | null): void {
  const ws = wb.addWorksheet("Ledger", { properties: { tabColor: { argb: C.primary } } });
  ws.columns = [
    { width: 12 }, { width: 18 }, { width: 42 }, { width: 15 }, { width: 15 }, { width: 16 },
  ];
  cabecalhoExcel(ws, r, e, "General ledger", 6);
  ws.addRow([]);

  const moedaNas = (linha: ExcelJS.Row, cols: number[]) => {
    for (const c of cols) linha.getCell(c).numFmt = FORMATO_MOEDA;
  };

  for (const conta of r.accounts) {
    const faixa = ws.addRow([`${conta.code}  ${conta.name}`, "", "", "Debit", "Credit", "Balance"]);
    faixa.font = { bold: true, color: { argb: C.surface } };
    faixa.eachCell((cel) => {
      cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
    });

    const abertura = ws.addRow(["Opening balance", "", "", null, null, conta.opening]);
    abertura.font = { bold: true };
    abertura.eachCell((cel) => {
      cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.accentSoft } };
    });
    moedaNas(abertura, [6]);

    conta.entries.forEach((l, i) => {
      const linha = ws.addRow([
        l.date, l.documentRef || l.sourceModule,
        l.counterparty || l.description || "",
        l.debit || null, l.credit || null, l.balance,
      ]);
      moedaNas(linha, [4, 5, 6]);
      if (i % 2 === 1) linha.eachCell((cel) => {
        cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.rowAlt } };
      });
    });

    const fecho = ws.addRow([
      "Movement and closing balance", "", "", conta.debit, conta.credit, conta.closing,
    ]);
    fecho.font = { bold: true, color: { argb: C.surface } };
    fecho.eachCell((cel) => {
      cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primaryMed } };
    });
    moedaNas(fecho, [4, 5, 6]);
    ws.addRow([]);
  }

  const aviso = ws.addRow([
    "Debit and credit totals of a partial selection do not agree with each other — "
    + "the contra entry may sit in an account that was not selected. Use the trial balance to prove the ledger.",
  ]);
  aviso.font = { size: 9, italic: true, color: { argb: C.muted } };
}

/**
 * Uma linha por lançamento, com a conta em coluna.
 *
 * É a folha que se filtra e se põe numa tabela dinâmica. A agrupada é para
 * ler; esta é para trabalhar — e quem concilia faz as duas coisas.
 */
function folhaPlana(wb: ExcelJS.Workbook, r: Razao, e: Timbre | null): void {
  const ws = wb.addWorksheet("Entries", { properties: { tabColor: { argb: C.accent } } });
  ws.columns = [
    { width: 11 }, { width: 11 }, { width: 10 }, { width: 26 }, { width: 18 },
    { width: 34 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 },
  ];
  cabecalhoExcel(ws, r, e, "Entries", 10);
  ws.addRow([]);

  const cabecalho = ws.addRow([
    "Posting date", "Doc date", "Account", "Account name", "Document",
    "Counterparty / description", "Source", "Debit", "Credit", "Balance",
  ]);
  cabecalho.font = { bold: true, color: { argb: C.surface } };
  cabecalho.eachCell((cel) => {
    cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
  });
  ws.views = [{ state: "frozen", ySplit: cabecalho.number }];
  ws.autoFilter = {
    from: { row: cabecalho.number, column: 1 },
    to: { row: cabecalho.number, column: 10 },
  };

  let i = 0;
  for (const conta of r.accounts) {
    for (const l of conta.entries) {
      const linha = ws.addRow([
        l.date, l.entryDate, conta.code, conta.name,
        l.documentRef || "", l.counterparty || l.description || "", l.sourceModule,
        l.debit || null, l.credit || null, l.balance,
      ]);
      for (const c of [8, 9, 10]) linha.getCell(c).numFmt = FORMATO_MOEDA;
      if (i++ % 2 === 1) linha.eachCell((cel) => {
        cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.rowAlt } };
      });
    }
  }

  const total = ws.addRow(["", "", "", "", "", "TOTAL", "", r.totals.debit, r.totals.credit, r.totals.closing]);
  total.font = { bold: true, color: { argb: C.surface } };
  total.eachCell((cel) => {
    cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primaryMed } };
  });
  for (const c of [8, 9, 10]) total.getCell(c).numFmt = FORMATO_MOEDA;
}
