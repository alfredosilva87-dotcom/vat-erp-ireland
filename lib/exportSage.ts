import { toCsv, type CsvFile } from "@/lib/exportCsv";
import type { Client, SalesEntry } from "@/lib/types";

const r2 = (n: any) => Number((Number(n) || 0).toFixed(2));

/** Sage/Irish convention: DD/MM/YYYY. Input is our stored yyyy-mm-dd. */
function ddmmyyyy(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
}

// Columns with no equivalent in this app's data model (SONumber, Productcode,
// AnalysisCode, VATCode, ContactCode, DueDate, Status, every Delivery* field,
// DivisionCode, SubDivisionCode) are left blank rather than guessed — a wrong
// VAT code or a fabricated delivery address would make the accountant's Sage
// import wrong in a way that's hard to notice.
const SAGE_SALES_HEADERS = [
  "TransactionType", "InvoiceNumber", "TransDate", "SONumber", "Productcode",
  "ProductDescription", "AnalysisCode", "Net", "Discount", "VATCode", "VATRate",
  "VAT", "Gross", "Quantity", "Price", "ContactCode", "DueDate", "Notes", "Status",
  "DeliveryAddressLine1", "DeliveryAddressLine2", "DeliveryAddressLine3",
  "DeliveryAddressLine4", "DeliveryAddressLine5", "DeliveryAddressLine6",
  "DeliveryTown", "DeliveryCounty", "DeliveryPostCode", "DeliveryCountry",
  "DivisionCode", "SubDivisionCode",
];

export function buildSageSalesCsv(client: Client | null, sales: SalesEntry[]): CsvFile {
  const rows = sales.map((s) => {
    const net = r2(s.net_amount);
    const vat = r2(s.vat_amount);
    const cols: Record<string, string | number | null> = {
      TransactionType: "SI",
      InvoiceNumber: s.doc_number || "",
      TransDate: ddmmyyyy(s.entry_date),
      Net: net,
      Discount: 0,
      VATRate: s.vat_rate ?? 0,
      VAT: vat,
      Gross: r2(net + vat),
      Quantity: 1,
      Price: net,
      Notes: s.customer || "",
    };
    return SAGE_SALES_HEADERS.map((h) => cols[h] ?? "");
  });

  const slug = (client?.name || "vendas").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return { name: `SalesInvoice_${slug}.csv`, content: toCsv(SAGE_SALES_HEADERS, rows) };
}

const SAGE_CONTACTS_HEADERS = [
  "Code", "ContactType", "BusinessIndividual", "Forename", "Surname",
  "Addr1Line1", "Addr1Line2", "Addr1Line3", "Addr1Line4", "Addr1Line5", "Addr1Line6",
  "Addr1Town", "Addr1County", "Addr1Country", "Postcode",
  "DeliveryAddrLine1", "DeliveryAddrLine2", "DeliveryAddrLine3", "DeliveryAddrLine4",
  "DeliveryAddrLine5", "DeliveryAddrLine6", "DeliveryAddrTown", "DeliveryAddrCounty",
  "DeliveryAddrCountry", "DeliveryAddrPostcode",
  "Phone1", "Mobile1", "Categories", "EMail1", "EMail2", "Web1",
  "Contact1Name", "Contcat1Position", "Contact1Mobile", "Contact1EMail",
  "Contact2Name", "Contact2Position", "Contact2Mobile", "Contact2EMail",
  "DefaultNominalCode", "DefaultVATCode", "VATNo",
];

export function buildSageContactsCsv(clients: Client[]): CsvFile {
  const rows = clients.map((c) => {
    // The app stores address as one free-text field — put it as-is in
    // Addr1Line1 rather than guessing where street/town/postcode split.
    const cols: Record<string, string | number | null> = {
      Code: c.client_code || "",
      ContactType: "C",
      BusinessIndividual: "B",
      Surname: c.name,
      Addr1Line1: c.address || "",
      Phone1: c.phone || "",
      EMail1: c.email || "",
      VATNo: c.vat_number || "",
    };
    return SAGE_CONTACTS_HEADERS.map((h) => cols[h] ?? "");
  });

  return { name: "Contacts.csv", content: toCsv(SAGE_CONTACTS_HEADERS, rows) };
}
