import { getServerSupabase } from "@/lib/supabase";

const sb = () => getServerSupabase();

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export interface DuplicateHeader {
  supplier_name: string | null;
  invoice_number: string | null;
  barcode: string | null;
  invoice_date: string | null;
  total_gross: number | null;
}

export interface DuplicateMatch {
  id: string;
  invoice_number: string | null;
  posting_date: string | null;
  total_gross: number | null;
}

/**
 * Looks for an invoice already on file for this client that is very likely
 * the same document, so the same receipt photographed twice under different
 * filenames doesn't silently double the client's purchases/credit.
 *
 * Checked in order of how trustworthy the signal is: a shared barcode (the
 * document's own long reference number) beats a shared invoice number, which
 * beats the weak fallback of supplier + date + total for receipts that carry
 * neither.
 */
export async function findDuplicate(
  clientId: string | null,
  header: DuplicateHeader
): Promise<DuplicateMatch | null> {
  if (!clientId) return null;
  const supplier = header.supplier_name ? norm(header.supplier_name) : null;

  const pick = "id,invoice_number,posting_date,total_gross";

  if (header.barcode) {
    const { data } = await sb()
      .from("invoices")
      .select(pick)
      .eq("client_id", clientId)
      .eq("barcode", header.barcode)
      .limit(1)
      .maybeSingle();
    if (data) return data as DuplicateMatch;
  }

  if (supplier && header.invoice_number) {
    const { data } = await sb()
      .from("invoices")
      .select(pick + ",supplier_name")
      .eq("client_id", clientId)
      .eq("invoice_number", header.invoice_number)
      .limit(20);
    const hit = (data || []).find((r: any) => r.supplier_name && norm(r.supplier_name) === supplier);
    if (hit) return hit as unknown as DuplicateMatch;
  }

  if (supplier && header.invoice_date && header.total_gross != null) {
    const { data } = await sb()
      .from("invoices")
      .select(pick + ",supplier_name")
      .eq("client_id", clientId)
      .eq("invoice_date", header.invoice_date)
      .limit(50);
    const hit = (data || []).find(
      (r: any) =>
        r.supplier_name &&
        norm(r.supplier_name) === supplier &&
        Math.abs(Number(r.total_gross) - header.total_gross!) < 0.01
    );
    if (hit) return hit as unknown as DuplicateMatch;
  }

  return null;
}
