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
 * Days a recent same-supplier, same-total invoice still counts as a likely
 * duplicate when the document itself has no date to compare.
 *
 * Found empirically: a retail till receipt (no invoice number, no barcode,
 * and often no date the reader can find) sent twice from the phone — once
 * read and saved the day it arrived, once the next day — passed every other
 * check silently, because `invoice_date` was null both times and the third
 * tier below never even ran its query. Same supplier, same total, saved
 * within a few days of each other is enough signal to ask, even without a
 * date; older matches are left alone; a coincidence six months apart is not
 * this bug, and warning about it would just teach the analyst to click
 * through the warning without reading it.
 */
const RECENT_DAYS = 7;

/**
 * Looks for an invoice already on file for this client that is very likely
 * the same document, so the same receipt photographed twice under different
 * filenames doesn't silently double the client's purchases/credit.
 *
 * Checked in order of how trustworthy the signal is: a shared barcode (the
 * document's own long reference number) beats a shared invoice number, which
 * beats supplier + date + total, which beats the weakest fallback — supplier
 * + total alone, only within a short recent window — for receipts that carry
 * neither a number nor a date the reader could find.
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

  // Sem data nenhuma no documento — o caso do recibo de balcão — a única coisa
  // que ainda distingue "mesma nota de novo" de "coincidência" é ter chegado
  // há pouco tempo. `created_at`, não `posting_date`: o analista pode lançar
  // as duas em datas de competência diferentes (foi o que aconteceu no teste
  // que achou este buraco), e é quando cada uma ENTROU no sistema que diz se
  // são a mesma remessa, não em qual mês cada uma foi contabilizada.
  if (!header.invoice_date && supplier && header.total_gross != null) {
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
    const { data } = await sb()
      .from("invoices")
      .select(pick + ",supplier_name,created_at")
      .eq("client_id", clientId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
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
