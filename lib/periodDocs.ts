import "server-only";
import { getServerSupabase } from "@/lib/supabase";

/**
 * Os documentos de um cliente num período — entrada e saída lado a lado.
 *
 * "Entrada" é nota de compra (`invoices`), "saída" é venda (`sales`). São duas
 * tabelas com formatos diferentes porque nasceram de fluxos diferentes; aqui
 * viram uma lista só, com os campos que a tela e o PDF precisam. A conversão
 * mora num lugar só de propósito: a tela e o exportador têm de mostrar
 * exatamente as mesmas linhas, senão o arquivo entregue ao cliente não bate
 * com o que a pessoa viu antes de clicar em exportar.
 */

export type Lado = "entrada" | "saida";

export type PeriodDoc = {
  id: string;
  lado: Lado;
  data: string | null;
  /** Fornecedor (entrada) ou cliente final (saída). */
  parte: string | null;
  numero: string | null;
  liquido: number;
  vat: number;
  total: number;
  document_path: string | null;
  original_filename: string | null;
};

const n = (v: unknown) => Number(v ?? 0) || 0;

export async function listPeriodDocs(
  clientId: string,
  de: string,
  ate: string,
  lados: Lado[] = ["entrada", "saida"]
): Promise<PeriodDoc[]> {
  const sb = getServerSupabase();
  const out: PeriodDoc[] = [];

  if (lados.includes("entrada")) {
    const { data } = await sb
      .from("invoices")
      .select("id,invoice_date,supplier_name,store_name,invoice_number,total_net,total_vat,total_gross,document_path,original_filename")
      .eq("client_id", clientId)
      .gte("invoice_date", de)
      .lte("invoice_date", ate)
      .order("invoice_date", { ascending: true });
    for (const r of (data ?? []) as any[]) {
      out.push({
        id: r.id, lado: "entrada", data: r.invoice_date,
        parte: r.supplier_name || r.store_name || null,
        numero: r.invoice_number,
        liquido: n(r.total_net), vat: n(r.total_vat), total: n(r.total_gross),
        document_path: r.document_path, original_filename: r.original_filename,
      });
    }
  }

  if (lados.includes("saida")) {
    const { data } = await sb
      .from("sales")
      .select("id,entry_date,customer,doc_number,net_amount,vat_amount,document_path,original_filename")
      .eq("client_id", clientId)
      .gte("entry_date", de)
      .lte("entry_date", ate)
      .order("entry_date", { ascending: true });
    for (const r of (data ?? []) as any[]) {
      // Venda guarda líquido e VAT; o bruto é a soma — não há coluna dele.
      const liquido = n(r.net_amount);
      const vat = n(r.vat_amount);
      out.push({
        id: r.id, lado: "saida", data: r.entry_date,
        parte: r.customer, numero: r.doc_number,
        liquido, vat, total: liquido + vat,
        document_path: r.document_path, original_filename: r.original_filename,
      });
    }
  }

  // Ordem cronológica com os dois lados misturados: é como o período foi
  // vivido, e é como se confere contra o extrato do banco.
  return out.sort((a, b) => String(a.data ?? "").localeCompare(String(b.data ?? "")));
}
