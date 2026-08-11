"use client";

/**
 * A trilha de auditoria e os documentos da nota (camada B3).
 *
 * Fica na própria tela da nota, e não numa tela de histórico separada, porque a
 * pergunta "quem mudou isso?" nasce olhando o número que parece errado. Um
 * histórico que exige lembrar que existe não é consultado.
 *
 * Lê de cima para baixo, do mais recente para o mais antigo — é a ordem em que
 * se procura o que aconteceu.
 */

import type { AuditEntry, InvoiceDocument } from "@/lib/reviewStore";

const ACTION_LABEL: Record<string, string> = {
  created: "Lançada",
  edited: "Cabeçalho alterado",
  item_edited: "Item alterado",
  item_added: "Item acrescentado",
  approved: "Conferida e aprovada",
  reopened: "Aprovação desfeita",
  documents_merged: "Documento juntado",
};

const FIELD_LABEL: Record<string, string> = {
  supplier_name: "fornecedor",
  store_name: "loja",
  supplier_vat: "VAT do fornecedor",
  invoice_number: "número",
  barcode: "código de barras",
  invoice_date: "data de emissão",
  posting_date: "data de lançamento",
  invoice_time: "hora",
  doc_type: "tipo",
  total_net: "total líquido",
  total_vat: "total de VAT",
  total_gross: "total bruto",
  branch_id: "filial",
  description: "descrição",
  quantity: "quantidade",
  unit_price: "preço unitário",
  net_amount: "valor",
  vat_rate_on_invoice: "alíquota do documento",
  expected_vat_rate: "alíquota da base",
  category_code: "categoria",
  account_code: "conta contábil",
  take_credit: "crédito",
  document: "documento",
};

const when = (iso: string) => iso.slice(0, 16).replace("T", " ");
const val = (v: string | null) => (v === null || v === "" ? "—" : v);

export default function InvoiceHistory({
  audit, documents, mainDocument, invoiceId,
}: {
  audit: AuditEntry[];
  documents: InvoiceDocument[];
  /** Se a nota tem o documento principal, para mostrar os dois lado a lado. */
  mainDocument: boolean;
  invoiceId: string;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card overflow-hidden">
        <p className="border-b border-line bg-surface-2/60 px-4 py-2.5 text-xs uppercase tracking-wide text-muted">
          Documentos ({(mainDocument ? 1 : 0) + documents.length})
        </p>
        {!mainDocument && !documents.length ? (
          <p className="px-4 py-3 text-sm text-muted">Esta nota não tem documento anexado.</p>
        ) : (
          <div className="divide-y divide-line/70 text-sm">
            {mainDocument && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="chip bg-brand-50 text-brand-700">principal</span>
                <span className="text-muted">o documento com que a nota foi lançada</span>
                <a className="ml-auto text-xs text-brand-700 underline underline-offset-2"
                  href={`/api/invoices/${invoiceId}/document`} target="_blank" rel="noreferrer">abrir</a>
              </div>
            )}
            {documents.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="chip bg-surface-2 border border-line text-muted">juntado</span>
                <span className="truncate">{d.filename || "documento"}</span>
                <span className="text-xs text-muted">{when(d.added_at)}</span>
                <a className="ml-auto text-xs text-brand-700 underline underline-offset-2"
                  href={`/api/invoices/documents/${d.id}`} target="_blank" rel="noreferrer">abrir</a>
              </div>
            ))}
          </div>
        )}
        {documents.length > 0 && (
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
            Documento juntado vem de uma duplicata: a segunda foto do mesmo recibo fica no lançamento em vez
            de ser descartada — muitas vezes é a mais legível das duas. Juntar <strong>não altera</strong>
            {" "}valor, crédito nem alíquota.
          </p>
        )}
      </div>

      <div className="card overflow-hidden">
        <p className="border-b border-line bg-surface-2/60 px-4 py-2.5 text-xs uppercase tracking-wide text-muted">
          Histórico ({audit.length})
        </p>
        {!audit.length ? (
          <p className="px-4 py-3 text-sm text-muted">
            Sem histórico. Notas lançadas antes desta versão do sistema não têm trilha — ela começa na
            primeira alteração feita a partir de agora.
          </p>
        ) : (
          <div className="max-h-[420px] divide-y divide-line/70 overflow-y-auto text-sm">
            {audit.map((a) => (
              <div key={a.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</span>
                  {a.field && <span className="text-muted">· {FIELD_LABEL[a.field] ?? a.field}</span>}
                  <span className="ml-auto text-xs text-muted tnum">{when(a.created_at)}</span>
                </div>
                {(a.old_value !== null || a.new_value !== null) && a.action !== "created" && (
                  <p className="mt-0.5 text-xs">
                    <span className="text-muted line-through">{val(a.old_value)}</span>
                    <span className="mx-1.5 text-muted">→</span>
                    <span className="font-medium">{val(a.new_value)}</span>
                  </p>
                )}
                <p className="mt-0.5 text-xs text-muted">
                  {a.actor_email || "sem usuário registrado"}
                  {a.note ? ` · ${a.note}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
