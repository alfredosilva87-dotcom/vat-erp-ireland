import * as XLSX from "xlsx";

const r2 = (n: number) => Number((Number(n) || 0).toFixed(2));

// Builds a multi-sheet workbook from the /api/clients/[id]/export payload.
export function buildClientWorkbook(data: any) {
  const wb = XLSX.utils.book_new();
  const { client, year, invoices = [], items = [], obligations = [], rates = { purchases: [], sales: [] }, series = [] } = data;

  const gross = invoices.reduce((a: number, i: any) => a + (i.total_gross || 0), 0);
  const credit = invoices.reduce((a: number, i: any) => a + (i.total_credit || 0), 0);

  const resumo: any[][] = [
    ["Client", client?.name ?? ""],
    ["Code", client?.client_code ?? ""],
    ["VAT number", client?.vat_number ?? ""],
    ["Year", year],
    ["Invoices", invoices.length],
    ["Total gross €", r2(gross)],
    ["Input credit €", r2(credit)],
    [],
    ["Month", "Gross €", "Credit €", "Docs"],
    ...series.map((s: any) => [s.month, s.gross, s.credit, s.count]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), "Resumo");

  const invHeader = ["Posting", "Issued", "Supplier", "Doc no", "Type", "Net €", "VAT €", "Gross €", "Credit €"];
  const invRows = invoices.map((i: any) => [i.posting_date || "", i.invoice_date || "", i.supplier_name || "", i.invoice_number || "", i.doc_type || "", i.total_net, i.total_vat, i.total_gross, i.total_credit]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([invHeader, ...invRows]), "Notas");

  const invById = new Map(invoices.map((i: any) => [i.id, i]));
  const itHeader = ["Date", "Supplier", "Item", "Category", "Account", "Account name", "Net €", "Rate %", "VAT €", "Credit €", "Take credit"];
  const itRows = items.map((it: any) => {
    const inv: any = invById.get(it.invoice_id) || {};
    return [inv.posting_date || inv.invoice_date || "", inv.supplier_name || "", it.description, it.category_name || "", it.account_code || "", it.account_name || "", it.net_amount, it.expected_vat_rate, it.vat_amount_on_invoice, it.credit_value, it.take_credit ? "yes" : "no"];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([itHeader, ...itRows]), "Itens");

  const oblHeader = ["Kind", "Period", "Due", "VAT sales (T1)", "VAT purchases (T2)", "Net (T3)", "Status"];
  const oblRows = obligations.map((o: any) => [o.kind, o.period_label, o.due_date, o.vat_on_sales, o.vat_on_purchases, o.net, o.status]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([oblHeader, ...oblRows]), "Apuracoes");

  const vatAoa: any[][] = [["ENTRADAS (compras) por alíquota"], ["Rate %", "Net €", "VAT €", "Credit €", "Docs"]];
  (rates.purchases || []).forEach((g: any) => vatAoa.push([g.rate, g.net, g.vat, g.credit, g.count]));
  vatAoa.push([], ["SAÍDAS (vendas) por alíquota"], ["Rate %", "Net €", "VAT €", "Docs"]);
  (rates.sales || []).forEach((g: any) => vatAoa.push([g.rate, g.net, g.vat, g.count]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(vatAoa), "VAT por aliquota");

  return wb;
}

export function downloadClientWorkbook(data: any) {
  const wb = buildClientWorkbook(data);
  const name = `${data.client?.client_code || "client"}_${data.year}.xlsx`;
  XLSX.writeFile(wb, name);
}
