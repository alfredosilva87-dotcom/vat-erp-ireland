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
import { useT, type TKey } from "@/lib/i18n";

const ACTION_KEY: Record<string, TKey> = {
  created: "hist.aCreated",
  edited: "hist.aEdited",
  item_edited: "hist.aItemEdited",
  item_added: "hist.aItemAdded",
  approved: "hist.aApproved",
  reopened: "hist.aReopened",
  documents_merged: "hist.aMerged",
};

const FIELD_KEY: Record<string, TKey> = {
  supplier_name: "hist.fSupplier",
  store_name: "hist.fStore",
  supplier_vat: "hist.fSupplierVat",
  invoice_number: "hist.fNumber",
  barcode: "hist.fBarcode",
  invoice_date: "hist.fIssueDate",
  posting_date: "hist.fPostingDate",
  invoice_time: "hist.fTime",
  doc_type: "hist.fType",
  total_net: "hist.fNet",
  total_vat: "hist.fVat",
  total_gross: "hist.fGross",
  branch_id: "hist.fBranch",
  description: "hist.fDescription",
  quantity: "hist.fQuantity",
  unit_price: "hist.fUnitPrice",
  net_amount: "hist.fAmount",
  vat_rate_on_invoice: "hist.fDocRate",
  expected_vat_rate: "hist.fBaseRate",
  category_code: "hist.fCategory",
  account_code: "hist.fAccount",
  take_credit: "hist.fCredit",
  document: "hist.fDocument",
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
  const { t } = useT();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card overflow-hidden">
        <p className="border-b border-line bg-surface-2/60 px-4 py-2.5 text-xs uppercase tracking-wide text-muted">
          {t("hist.docsTitle", { n: (mainDocument ? 1 : 0) + documents.length })}
        </p>
        {!mainDocument && !documents.length ? (
          <p className="px-4 py-3 text-sm text-muted">{t("hist.noDocs")}</p>
        ) : (
          <div className="divide-y divide-line/70 text-sm">
            {mainDocument && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="chip bg-brand-50 text-brand-700">{t("hist.main")}</span>
                <span className="text-muted">{t("hist.mainHint")}</span>
                <a className="ml-auto text-xs text-brand-700 underline underline-offset-2"
                  href={`/api/invoices/${invoiceId}/document`} target="_blank" rel="noreferrer">{t("hist.open")}</a>
              </div>
            )}
            {documents.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="chip bg-surface-2 border border-line text-muted">{t("hist.mergedChip")}</span>
                <span className="truncate">{d.filename || t("hist.fDocument")}</span>
                <span className="text-xs text-muted">{when(d.added_at)}</span>
                <a className="ml-auto text-xs text-brand-700 underline underline-offset-2"
                  href={`/api/invoices/documents/${d.id}`} target="_blank" rel="noreferrer">{t("hist.open")}</a>
              </div>
            ))}
          </div>
        )}
        {documents.length > 0 && (
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
            {t("hist.docNote")}
          </p>
        )}
      </div>

      <div className="card overflow-hidden">
        <p className="border-b border-line bg-surface-2/60 px-4 py-2.5 text-xs uppercase tracking-wide text-muted">
          {t("hist.title", { n: audit.length })}
        </p>
        {!audit.length ? (
          <p className="px-4 py-3 text-sm text-muted">
            {t("hist.empty")}
          </p>
        ) : (
          <div className="max-h-[420px] divide-y divide-line/70 overflow-y-auto text-sm">
            {audit.map((a) => (
              <div key={a.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-medium">{ACTION_KEY[a.action] ? t(ACTION_KEY[a.action]) : a.action}</span>
                  {a.field && <span className="text-muted">· {FIELD_KEY[a.field] ? t(FIELD_KEY[a.field]) : a.field}</span>}
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
                  {a.actor_email || t("hist.noActor")}
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
