// CSV export. Rows are shaped exactly like the Excel sheets so the two files
// can be compared line by line.

const r2 = (n: any) => Number((Number(n) || 0).toFixed(2));

/** RFC-4180 escaping: quote when the value holds a comma, quote or newline. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

export interface CsvInput {
  client: any;
  start: string;
  end: string;
  sets?: string[];
  invoices: any[];
  items: any[];
  sales?: any[];
  accounts?: any[];
  obligations: any[];
  rates: { purchases: any[]; sales: any[] };
  kpis: { salesVat: number; inputCredit: number; vatPayable: number };
}

export interface CsvFile { name: string; content: string }

/**
 * One CSV per selected dataset. Returning a list (rather than a single blob)
 * keeps each file importable straight into Excel/Sheets without cleanup.
 */
export function buildClientCsvs(d: CsvInput): CsvFile[] {
  const has = (s: string) => !d.sets?.length || d.sets.includes(s);
  const out: CsvFile[] = [];
  const slug = (d.client?.name || "client").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const suffix = `${slug}_${d.start}_${d.end}`;

  if (has("invoices")) {
    out.push({
      name: `notas_${suffix}.csv`,
      content: toCsv(
        ["Lancamento", "Emissao", "Fornecedor", "Filial", "Documento", "Tipo", "Liquido", "VAT", "Bruto", "Credito", "Revisar"],
        d.invoices.map((i) => [
          i.posting_date || "", i.invoice_date || "", i.supplier_name || "", i.branch_name || "",
          i.invoice_number || "", i.doc_type || "",
          r2(i.total_net), r2(i.total_vat), r2(i.total_gross), r2(i.total_credit),
          i.needs_review ? "Sim" : "",
        ])
      ),
    });
  }

  if (has("items")) {
    const byId = new Map(d.invoices.map((i) => [i.id, i]));
    out.push({
      name: `itens_${suffix}.csv`,
      content: toCsv(
        ["Data", "Fornecedor", "Item", "Categoria", "Conta", "Nome da conta", "Liquido", "Taxa", "VAT", "Credito", "Toma credito"],
        d.items.map((x) => {
          const i: any = byId.get(x.invoice_id) || {};
          return [
            i.posting_date || i.invoice_date || "", i.supplier_name || "", x.description,
            x.category_name || "", x.account_code || "", x.account_name || "",
            r2(x.net_amount), Number(x.expected_vat_rate ?? 0), r2(x.vat_amount_on_invoice), r2(x.credit_value),
            x.take_credit ? "Sim" : "Nao",
          ];
        })
      ),
    });
  }

  if (has("sales")) {
    out.push({
      name: `vendas_${suffix}.csv`,
      content: toCsv(
        ["Data", "Documento", "Cliente", "Liquido", "Taxa", "VAT", "Bruto", "Conta"],
        (d.sales ?? []).map((s) => [
          s.entry_date || "", s.doc_number || "", s.customer || "",
          r2(s.net_amount), Number(s.vat_rate ?? 0), r2(s.vat_amount),
          r2((s.net_amount || 0) + (s.vat_amount || 0)), s.account_code || "",
        ])
      ),
    });
  }

  if (has("obligations")) {
    const today = new Date().toISOString().slice(0, 10);
    out.push({
      name: `apuracoes_${suffix}.csv`,
      content: toCsv(
        ["Tipo", "Periodo", "Vencimento", "T1 VAT vendas", "T2 VAT compras", "T3 Liquido", "Situacao"],
        d.obligations.map((o) => [
          o.kind, o.period_label, o.due_date,
          r2(o.vat_on_sales), r2(o.vat_on_purchases), r2(o.net),
          o.status === "filed" ? "Entregue" : o.due_date < today ? "Vencida" : "Em aberto",
        ])
      ),
    });
  }

  if (has("rates")) {
    const allRates = Array.from(new Set([
      ...d.rates.sales.map((r: any) => r.rate),
      ...d.rates.purchases.map((r: any) => r.rate),
    ])).sort((a, b) => b - a);
    out.push({
      name: `vat-por-aliquota_${suffix}.csv`,
      content: toCsv(
        ["Taxa", "Vendas liquidas", "VAT vendas T1", "Compras liquidas", "Credito T2", "Liquido T3"],
        allRates.map((rate) => {
          const s = d.rates.sales.find((x: any) => x.rate === rate);
          const p = d.rates.purchases.find((x: any) => x.rate === rate);
          return [`${rate}%`, r2(s?.net), r2(s?.vat), r2(p?.net), r2(p?.credit), r2((s?.vat ?? 0) - (p?.credit ?? 0))];
        })
      ),
    });
  }

  if (has("accounts")) {
    out.push({
      name: `plano-de-contas_${slug}.csv`,
      content: toCsv(
        ["Codigo", "Descricao", "Conta pai", "Ativa"],
        (d.accounts ?? []).map((a) => [a.code || "", a.description || "", a.parent_code || "", a.active === false ? "Nao" : "Sim"])
      ),
    });
  }

  return out;
}
