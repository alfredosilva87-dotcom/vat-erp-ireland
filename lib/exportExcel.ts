import ExcelJS from "exceljs";

// Styled, multi-sheet workbook built server-side with ExcelJS.
//
// Follows the BI-report design system (Dashboard sheet with KPI cards, then
// Summary and data sheets; header rows in a dark fill with white bold text,
// alternating row bands, frozen headers, tab colours), with the app's purple
// palette instead of the default blue. SheetJS was replaced here because its
// community build cannot write cell styling.

const C = {
  primary: "FF1D1740",      // deep purple — headers
  primaryMed: "FF2F2860",
  accent: "FF7C5CFF",       // brand purple — KPI values, highlights
  accentSoft: "FFEFEBFF",
  success: "FF159A6B",
  successSoft: "FFE6F5EF",
  danger: "FFDC2626",
  dangerSoft: "FFFDEBEB",
  warning: "FFD97706",
  warningSoft: "FFFCF1E2",
  surface: "FFFFFFFF",
  bg: "FFF6F5FC",
  border: "FFE7E4F3",
  text: "FF1A1533",
  muted: "FF6B6590",
  rowAlt: "FFF5F3FD",
};

const MONEY = '#,##0.00';
const FONT = "Calibri";
const r2 = (n: any) => Number((Number(n) || 0).toFixed(2));

type Tone = "accent" | "success" | "danger" | "warning";
const toneColor: Record<Tone, string> = {
  accent: C.accent, success: C.success, danger: C.danger, warning: C.warning,
};

function thin(color = C.border): Partial<ExcelJS.Borders> {
  const s = { style: "thin" as const, color: { argb: color } };
  return { top: s, left: s, bottom: s, right: s };
}

/** Draws one KPI card: label, big value, and a caption, with a top accent rule. */
function kpiCard(
  ws: ExcelJS.Worksheet,
  col: number,      // 1-based left column of the 3-wide card
  label: string,
  value: number,
  caption: string,
  tone: Tone
) {
  const L = ws.getColumn(col).letter;
  const R = ws.getColumn(col + 2).letter;

  ws.mergeCells(`${L}5:${R}5`);
  const lab = ws.getCell(`${L}5`);
  lab.value = label.toUpperCase();
  lab.font = { name: FONT, size: 9, bold: true, color: { argb: C.muted } };
  lab.alignment = { horizontal: "center", vertical: "middle" };
  lab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.surface } };
  lab.border = { top: { style: "thick", color: { argb: toneColor[tone] } } };

  ws.mergeCells(`${L}6:${R}8`);
  const val = ws.getCell(`${L}6`);
  val.value = value;
  val.numFmt = `"€ "${MONEY}`;
  val.font = { name: FONT, size: 22, bold: true, color: { argb: toneColor[tone] } };
  val.alignment = { horizontal: "center", vertical: "middle" };
  val.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.surface } };

  ws.mergeCells(`${L}9:${R}10`);
  const cap = ws.getCell(`${L}9`);
  cap.value = caption;
  cap.font = { name: FONT, size: 9, color: { argb: C.muted } };
  cap.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cap.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.surface } };
  cap.border = { bottom: { style: "thin", color: { argb: C.border } } };
}

/** Header row + banded data rows, frozen header, auto-ish column widths. */
function table(
  ws: ExcelJS.Worksheet,
  headers: string[],
  rows: (string | number | null)[][],
  opts: { moneyCols?: number[]; startRow?: number; totals?: (string | number | null)[] } = {}
) {
  const start = opts.startRow ?? 1;
  const money = new Set(opts.moneyCols ?? []);

  const head = ws.getRow(start);
  headers.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: C.surface } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = thin(C.primaryMed);
  });
  head.height = 24;

  rows.forEach((r, ri) => {
    const row = ws.getRow(start + 1 + ri);
    r.forEach((v, ci) => {
      const c = row.getCell(ci + 1);
      c.value = v as any;
      c.font = { name: FONT, size: 10, color: { argb: C.text } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ri % 2 ? C.rowAlt : C.surface } };
      c.border = thin();
      if (money.has(ci)) { c.numFmt = MONEY; c.alignment = { horizontal: "right" }; }
    });
  });

  if (opts.totals) {
    const row = ws.getRow(start + 1 + rows.length);
    opts.totals.forEach((v, ci) => {
      const c = row.getCell(ci + 1);
      c.value = v as any;
      c.font = { name: FONT, size: 10, bold: true, color: { argb: C.text } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.accentSoft } };
      c.border = thin();
      if (money.has(ci)) { c.numFmt = MONEY; c.alignment = { horizontal: "right" }; }
    });
  }

  headers.forEach((h, i) => {
    const widest = Math.max(
      h.length,
      ...rows.map((r) => String(r[i] ?? "").length),
      ...(opts.totals ? [String(opts.totals[i] ?? "").length] : [])
    );
    ws.getColumn(i + 1).width = Math.min(Math.max(widest + 3, 11), 44);
  });

  ws.views = [{ state: "frozen", ySplit: start }];
}

function sheetTitle(ws: ExcelJS.Worksheet, title: string, subtitle: string, lastCol = "H") {
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell("A1");
  t.value = title;
  t.font = { name: FONT, size: 16, bold: true, color: { argb: C.primary } };
  t.alignment = { vertical: "middle" };
  ws.getRow(1).height = 26;

  ws.mergeCells(`A2:${lastCol}2`);
  const s = ws.getCell("A2");
  s.value = subtitle;
  s.font = { name: FONT, size: 10, color: { argb: C.muted } };
}

export interface WorkbookInput {
  client: any;
  year: number;
  /** Period actually covered, shown in the header. */
  start?: string;
  end?: string;
  /** Datasets to include; omit for everything. */
  sets?: string[];
  kpis: {
    salesGross: number; salesVat: number; purchaseGross: number;
    inputCredit: number; vatPayable: number; invoiceCount: number; salesCount: number;
  };
  series: { month: string; gross: number; credit: number; sales: number; salesVat: number; count: number }[];
  rates: { purchases: any[]; sales: any[] };
  obligations: any[];
  invoices: any[];
  items: any[];
  sales?: any[];
  accounts?: any[];
}

export async function buildClientWorkbook(d: WorkbookInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "VAT Reader — Ireland ERP";
  wb.created = new Date();

  const clientName = d.client?.name ?? "Client";
  const generated = new Date().toISOString().slice(0, 10);
  const has = (s: string) => !d.sets?.length || d.sets.includes(s);
  const period = d.start && d.end ? `${d.start} to ${d.end}` : String(d.year);

  // ---------------- Sheet 1: Dashboard ----------------
  const dash = wb.addWorksheet("Dashboard", {
    properties: { tabColor: { argb: C.primary } },
    views: [{ showGridLines: false }],
  });
  dash.getColumn(1).width = 2;
  for (let c = 2; c <= 16; c++) dash.getColumn(c).width = 12;

  sheetTitle(
    dash,
    `${clientName} — Fiscal summary`,
    `${d.client?.client_code ?? ""} · ${d.client?.activity_label ?? ""}` +
      `${d.client?.vat_number ? ` · VAT ${d.client.vat_number}` : ""}` +
      ` · Period ${period} · Generated ${generated}`,
    "P"
  );

  kpiCard(dash, 2, "Revenue (T1)", d.kpis.salesGross, `${d.kpis.salesCount} sale(s) posted`, "accent");
  kpiCard(dash, 6, "Purchases (T2)", d.kpis.purchaseGross, `${d.kpis.invoiceCount} invoice(s) processed`, "success");
  kpiCard(dash, 10, "VAT payable (T3)", d.kpis.vatPayable,
    d.kpis.vatPayable >= 0 ? "Payable to Revenue" : "Recoverable from Revenue",
    d.kpis.vatPayable >= 0 ? "danger" : "success");
  kpiCard(dash, 14, "Input credit", d.kpis.inputCredit, "Recoverable VAT approved", "warning");

  // Monthly table feeding the chart below it
  const mStart = 13;
  dash.getCell(`B${mStart - 1}`).value = "Monthly activity";
  dash.getCell(`B${mStart - 1}`).font = { name: FONT, size: 12, bold: true, color: { argb: C.primaryMed } };

  const mHead = ["Month", "Sales (T1) €", "Purchases (T2) €", "Credit €", "VAT sales €", "Invoices"];
  mHead.forEach((h, i) => {
    const c = dash.getCell(mStart, i + 2);
    c.value = h;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: C.surface } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
    c.alignment = { horizontal: "center" };
    c.border = thin(C.primaryMed);
  });
  d.series.forEach((s, i) => {
    const vals = [s.month, r2(s.sales), r2(s.gross), r2(s.credit), r2(s.salesVat), s.count];
    vals.forEach((v, ci) => {
      const c = dash.getCell(mStart + 1 + i, ci + 2);
      c.value = v as any;
      c.font = { name: FONT, size: 10, color: { argb: C.text } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 ? C.rowAlt : C.surface } };
      c.border = thin();
      if (ci >= 1 && ci <= 4) { c.numFmt = MONEY; c.alignment = { horizontal: "right" }; }
    });
  });

  // ---------------- Sheet 2: Summary ----------------
  const sum = wb.addWorksheet("Summary", { properties: { tabColor: { argb: C.accent } }, views: [{ showGridLines: false }] });
  sum.getColumn(1).width = 2;
  sum.getColumn(2).width = 34;
  sum.getColumn(3).width = 22;
  sheetTitle(sum, "Executive summary", `${clientName} · fiscal year ${d.year}`, "F");

  const bestMonth = [...d.series].sort((a, b) => b.sales - a.sales)[0];
  const overdue = d.obligations.filter(
    (o) => o.status === "open" && o.due_date < generated
  ).length;

  const facts: [string, any, string?][] = [
    ["Total revenue (T1)", d.kpis.salesGross, "money"],
    ["VAT on sales (T1)", d.kpis.salesVat, "money"],
    ["Total purchases (T2)", d.kpis.purchaseGross, "money"],
    ["Input credit (T2)", d.kpis.inputCredit, "money"],
    ["Net position (T3)", d.kpis.vatPayable, "money"],
    ["Purchase invoices processed", d.kpis.invoiceCount],
    ["Sales posted", d.kpis.salesCount],
    ["Best sales month", bestMonth && bestMonth.sales > 0 ? `${bestMonth.month} (€ ${bestMonth.sales.toFixed(2)})` : "—"],
    ["Overdue open obligations", overdue],
  ];
  facts.forEach(([label, value, kind], i) => {
    const row = 5 + i;
    const l = sum.getCell(row, 2);
    l.value = label;
    l.font = { name: FONT, size: 10, color: { argb: C.muted } };
    l.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 ? C.rowAlt : C.surface } };
    l.border = thin();
    const v = sum.getCell(row, 3);
    v.value = value as any;
    v.font = { name: FONT, size: 11, bold: true, color: { argb: C.text } };
    v.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 ? C.rowAlt : C.surface } };
    v.border = thin();
    if (kind === "money") { v.numFmt = `"€ "${MONEY}`; v.alignment = { horizontal: "right" }; }
  });

  const note = sum.getCell(`B${5 + facts.length + 2}`);
  note.value =
    "Figures calculated from sales (T1) and purchase invoices (T2) posted in the system. " +
    "Credit classification is suggested and editable — it does not replace the accountant's review.";
  note.font = { name: FONT, size: 9, italic: true, color: { argb: C.muted } };
  sum.mergeCells(`B${5 + facts.length + 2}:F${5 + facts.length + 3}`);
  note.alignment = { wrapText: true, vertical: "top" };

  // ---------------- Sheet 3: VAT by rate ----------------
  if (has("rates")) {
  const vat = wb.addWorksheet("VAT by rate", { properties: { tabColor: { argb: C.accent } } });
  const allRates = Array.from(new Set([
    ...d.rates.sales.map((r: any) => r.rate),
    ...d.rates.purchases.map((r: any) => r.rate),
  ])).sort((a, b) => b - a);

  const vatRows = allRates.map((rate) => {
    const s = d.rates.sales.find((x: any) => x.rate === rate);
    const p = d.rates.purchases.find((x: any) => x.rate === rate);
    return [
      `${rate}%`,
      r2(s?.net), r2(s?.vat),
      r2(p?.net), r2(p?.credit),
      r2((s?.vat ?? 0) - (p?.credit ?? 0)),
    ];
  });
  table(vat,
    ["Rate", "Net sales €", "VAT sales (T1) €", "Net purchases €", "Credit (T2) €", "Net (T3) €"],
    vatRows,
    {
      moneyCols: [1, 2, 3, 4, 5],
      totals: [
        "Total",
        r2(vatRows.reduce((a, r) => a + (r[1] as number), 0)),
        r2(d.kpis.salesVat),
        r2(vatRows.reduce((a, r) => a + (r[3] as number), 0)),
        r2(d.kpis.inputCredit),
        r2(d.kpis.vatPayable),
      ],
    }
  );
  }

  // ---------------- Sheet 4: Obligations ----------------
  if (has("obligations")) {
  const obl = wb.addWorksheet("Obligations", { properties: { tabColor: { argb: C.accent } } });
  table(obl,
    ["Type", "Period", "Due", "T1 · VAT sales €", "T2 · VAT purchases €", "T3 · Net €", "Status"],
    d.obligations.map((o: any) => [
      o.kind, o.period_label, o.due_date,
      r2(o.vat_on_sales), r2(o.vat_on_purchases), r2(o.net),
      o.status === "filed" ? "Filed" : o.due_date < generated ? "Overdue" : "Open",
    ]),
    { moneyCols: [3, 4, 5] }
  );
  if (d.obligations.length) {
    obl.addConditionalFormatting({
      ref: `G2:G${d.obligations.length + 1}`,
      rules: [{
        type: "containsText", operator: "containsText", text: "Overdue", priority: 1,
        style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: C.dangerSoft } }, font: { color: { argb: C.danger }, bold: true } },
      }],
    });
  }
  }

  // ---------------- Sheet 5: Invoices ----------------
  if (has("invoices")) {
  const inv = wb.addWorksheet("Invoices", { properties: { tabColor: { argb: C.accent } } });
  table(inv,
    ["Posted", "Issued", "Supplier", "Branch", "Document", "Type", "Net €", "VAT €", "Gross €", "Credit €", "Review"],
    d.invoices.map((i: any) => [
      i.posting_date || "", i.invoice_date || "", i.supplier_name || "", i.branch_name || "",
      i.invoice_number || "", i.doc_type || "",
      r2(i.total_net), r2(i.total_vat), r2(i.total_gross), r2(i.total_credit),
      i.needs_review ? "Yes" : "",
    ]),
    { moneyCols: [6, 7, 8, 9] }
  );
  }

  // ---------------- Sheet 6: Items ----------------
  if (has("items")) {
  const it = wb.addWorksheet("Items", { properties: { tabColor: { argb: C.accent } } });
  const invById = new Map(d.invoices.map((i: any) => [i.id, i]));
  table(it,
    ["Date", "Supplier", "Item", "Category", "Account", "Account name", "Net €", "Rate %", "VAT €", "Credit €", "Take credit"],
    d.items.map((x: any) => {
      const i: any = invById.get(x.invoice_id) || {};
      return [
        i.posting_date || i.invoice_date || "", i.supplier_name || "", x.description,
        x.category_name || "", x.account_code || "", x.account_name || "",
        r2(x.net_amount), Number(x.expected_vat_rate ?? 0), r2(x.vat_amount_on_invoice), r2(x.credit_value),
        x.take_credit ? "Yes" : "No",
      ];
    }),
    { moneyCols: [6, 8, 9] }
  );
  }

  // ---------------- Sheet 7: Sales (T1) ----------------
  if (has("sales")) {
    const sl = wb.addWorksheet("Sales", { properties: { tabColor: { argb: C.accent } } });
    const rows = (d.sales ?? []).map((s: any) => [
      s.entry_date || "", s.doc_number || "", s.customer || "",
      r2(s.net_amount), Number(s.vat_rate ?? 0), r2(s.vat_amount),
      r2((s.net_amount || 0) + (s.vat_amount || 0)), s.account_code || "",
    ]);
    table(sl,
      ["Date", "Document", "Customer", "Net €", "Rate %", "VAT €", "Gross €", "Account"],
      rows,
      {
        moneyCols: [3, 5, 6],
        totals: [
          "Total", "", "",
          r2(rows.reduce((a, r) => a + (r[3] as number), 0)), "",
          r2(rows.reduce((a, r) => a + (r[5] as number), 0)),
          r2(rows.reduce((a, r) => a + (r[6] as number), 0)), "",
        ],
      }
    );
  }

  // ---------------- Sheet 8: Chart of accounts ----------------
  if (has("accounts")) {
    const acc = wb.addWorksheet("Chart of accounts", { properties: { tabColor: { argb: C.accent } } });
    table(acc,
      ["Code", "Description", "Parent account", "Active"],
      (d.accounts ?? []).map((a: any) => [
        a.code || "", a.description || "", a.parent_code || "", a.active === false ? "No" : "Yes",
      ])
    );
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
