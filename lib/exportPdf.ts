import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// PDF report built in the browser with jsPDF. Mirrors the Excel workbook:
// same KPI header, same tables, same purple identity — so a client comparing
// the two files sees identical numbers and layout.

const PURPLE: [number, number, number] = [124, 92, 255];
const INK: [number, number, number] = [26, 21, 51];
const MUTED: [number, number, number] = [107, 101, 144];
const ROW_ALT: [number, number, number] = [245, 243, 253];

const r2 = (n: any) => Number((Number(n) || 0).toFixed(2));
const money = (n: any) =>
  r2(n).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface PdfInput {
  client: any;
  start: string;
  end: string;
  sets?: string[];
  kpis: {
    salesGross: number; salesVat: number; purchaseGross: number;
    inputCredit: number; vatPayable: number; invoiceCount: number; salesCount: number;
  };
  invoices: any[];
  items: any[];
  sales?: any[];
  accounts?: any[];
  obligations: any[];
  rates: { purchases: any[]; sales: any[] };
}

export function buildClientPdf(d: PdfInput): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const has = (s: string) => !d.sets?.length || d.sets.includes(s);

  // ---- header band ----
  doc.setFillColor(...PURPLE);
  doc.rect(0, 0, W, 64, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold").setFontSize(16);
  doc.text(d.client?.name || "Client", 40, 28);
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(
    [
      d.client?.client_code,
      d.client?.activity_label,
      d.client?.vat_number ? `VAT ${d.client.vat_number}` : null,
      `Period ${d.start} to ${d.end}`,
    ].filter(Boolean).join("  ·  "),
    40, 45
  );

  // ---- KPI strip ----
  const kpis: [string, number][] = [
    ["Revenue (T1)", d.kpis.salesGross],
    ["Purchases (T2)", d.kpis.purchaseGross],
    ["VAT payable (T3)", d.kpis.vatPayable],
    ["Input credit", d.kpis.inputCredit],
  ];
  const cardW = (W - 80 - 30) / 4;
  kpis.forEach(([label, value], i) => {
    const x = 40 + i * (cardW + 10);
    doc.setDrawColor(231, 228, 243).setFillColor(255, 255, 255);
    doc.roundedRect(x, 78, cardW, 46, 4, 4, "FD");
    doc.setTextColor(...MUTED).setFont("helvetica", "normal").setFontSize(7.5);
    doc.text(label.toUpperCase(), x + 10, 94);
    doc.setTextColor(...PURPLE).setFont("helvetica", "bold").setFontSize(14);
    doc.text(`€ ${money(value)}`, x + 10, 114);
  });

  let y = 142;
  const section = (title: string, head: string[], body: any[][], foot?: any[][]) => {
    if (!body.length) return;
    doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(11);
    doc.text(title, 40, y);
    autoTable(doc, {
      startY: y + 8,
      head: [head],
      body,
      foot,
      margin: { left: 40, right: 40 },
      styles: { font: "helvetica", fontSize: 7.5, cellPadding: 4, textColor: INK, lineColor: [231, 228, 243], lineWidth: 0.5 },
      headStyles: { fillColor: [29, 23, 64], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5 },
      footStyles: { fillColor: [239, 235, 255], textColor: INK, fontStyle: "bold" },
      alternateRowStyles: { fillColor: ROW_ALT },
      didDrawPage: () => { /* keeps the table inside the margins on page breaks */ },
    });
    y = (doc as any).lastAutoTable.finalY + 26;
    if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = 50; }
  };

  if (has("rates")) {
    const allRates = Array.from(new Set([
      ...d.rates.sales.map((r: any) => r.rate),
      ...d.rates.purchases.map((r: any) => r.rate),
    ])).sort((a, b) => b - a);
    const rows = allRates.map((rate) => {
      const s = d.rates.sales.find((x: any) => x.rate === rate);
      const p = d.rates.purchases.find((x: any) => x.rate === rate);
      return [`${rate}%`, money(s?.net), money(s?.vat), money(p?.net), money(p?.credit), money((s?.vat ?? 0) - (p?.credit ?? 0))];
    });
    section(
      "Summary by VAT rate",
      ["Rate", "Net sales €", "VAT sales (T1) €", "Net purchases €", "Credit (T2) €", "Net (T3) €"],
      rows,
      [["Total", money(rows.reduce((a, r) => a + Number(String(r[1]).replace(/,/g, "")), 0)),
        money(d.kpis.salesVat), "", money(d.kpis.inputCredit), money(d.kpis.vatPayable)]]
    );
  }

  if (has("obligations")) {
    const today = new Date().toISOString().slice(0, 10);
    section("Obligations", ["Type", "Period", "Due", "T1 €", "T2 €", "T3 €", "Status"],
      d.obligations.map((o) => [
        o.kind, o.period_label, o.due_date,
        money(o.vat_on_sales), money(o.vat_on_purchases), money(o.net),
        o.status === "filed" ? "Filed" : o.due_date < today ? "Overdue" : "Open",
      ]));
  }

  if (has("invoices")) {
    section("Purchase invoices",
      ["Posted", "Issued", "Supplier", "Document", "Net €", "VAT €", "Gross €", "Credit €"],
      d.invoices.map((i) => [
        i.posting_date || "", i.invoice_date || "", i.supplier_name || "", i.invoice_number || "",
        money(i.total_net), money(i.total_vat), money(i.total_gross), money(i.total_credit),
      ]));
  }

  if (has("sales")) {
    section("Sales (T1)",
      ["Date", "Document", "Customer", "Net €", "Rate %", "VAT €", "Gross €"],
      (d.sales ?? []).map((s) => [
        s.entry_date || "", s.doc_number || "", s.customer || "",
        money(s.net_amount), String(s.vat_rate ?? 0), money(s.vat_amount),
        money((s.net_amount || 0) + (s.vat_amount || 0)),
      ]));
  }

  if (has("items")) {
    const byId = new Map(d.invoices.map((i) => [i.id, i]));
    section("Items",
      ["Date", "Supplier", "Item", "Category", "Net €", "Rate %", "Credit €", "Take credit"],
      d.items.map((x) => {
        const i: any = byId.get(x.invoice_id) || {};
        return [
          i.posting_date || i.invoice_date || "", i.supplier_name || "", x.description,
          x.category_name || "", money(x.net_amount), String(x.expected_vat_rate ?? 0),
          money(x.credit_value), x.take_credit ? "Yes" : "No",
        ];
      }));
  }

  if (has("accounts")) {
    section("Chart of accounts", ["Code", "Description", "Parent account", "Active"],
      (d.accounts ?? []).map((a) => [a.code || "", a.description || "", a.parent_code || "", a.active === false ? "No" : "Yes"]));
  }

  // ---- footer on every page ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setTextColor(...MUTED).setFont("helvetica", "normal").setFontSize(7.5);
    doc.text(
      `VAT Reader — Ireland ERP  ·  generated ${new Date().toISOString().slice(0, 10)}  ·  classification suggested and editable, does not replace the accountant's review`,
      40, doc.internal.pageSize.getHeight() - 20
    );
    doc.text(`${p} / ${pages}`, W - 40, doc.internal.pageSize.getHeight() - 20, { align: "right" });
  }

  return doc;
}

export function downloadClientPdf(d: PdfInput) {
  const slug = (d.client?.name || "client").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  buildClientPdf(d).save(`vat-report_${slug}_${d.start}_${d.end}.pdf`);
}
