/**
 * Ler um documento e gravá-lo como nota — o caminho, num lugar só.
 *
 * Extraído na camada B2 porque passou a existir uma segunda porta de entrada: a
 * fila do e-mail. Duas cópias desta orquestração divergiriam, e o lugar onde
 * elas divergiriam é a montagem do payload de gravação — que é justamente onde
 * mora a conta contábil decidida pela regra de fornecedor (camada B1). Uma cópia
 * esquecida de mandar `account_code` faria a regra parar de funcionar só numa das
 * duas telas, e ninguém ligaria uma coisa à outra.
 *
 * Aqui não há estado nem interface: são as duas chamadas de rede que as duas
 * telas fazem, com os mesmos campos.
 */

import type { AnalyzedItem, DocKind } from "@/lib/types";

export type IngestHeader = {
  supplier_name: string | null; store_name: string | null; supplier_vat: string | null;
  invoice_number: string | null; barcode: string | null; invoice_date: string | null;
  invoice_time: string | null; doc_type: string;
  /** O que o documento é, para a tela separar sujeira de leitura fraca. */
  doc_kind?: DocKind; doc_kind_reason?: string | null;
  total_net: number | null; total_vat: number | null; total_gross: number | null;
};

/** Qual regra de fornecedor pegou o documento (camada B1). */
export type SupplierRuleHit = {
  id: string; label: string; matched_by: "vat" | "name" | null;
  account_code: string | null; vat_category_code: string | null; line_items_off: boolean;
};

export type IngestDocument = {
  filename: string; engine: string; confidence: number; needs_review: boolean; issues: string[];
  audit?: { engine: string; confidence: number }[]; base_source: string;
  ai_matched?: number; cache_matched?: number; supplier_rule?: SupplierRuleHit | null;
  header: IngestHeader; items: AnalyzedItem[];
  /** 1-indexado, inclusivo; nulo quando o arquivo não foi dividido. */
  page_range: [number, number] | null;
  /** Os bytes da nota separada, quando um PDF trazia várias dentro. */
  pdf_base64: string | null;
};

export interface ReadContext {
  clientId: string;
  activityCode: string;
  defaultCreditUnmatched: boolean;
  relatedCategories: string[];
}

/**
 * Lê um arquivo. Devolve UM documento no caso normal e vários quando o PDF
 * trazia um lote de notas escaneadas em sequência.
 */
export async function readDocumentFile(file: File, ctx: ReadContext): Promise<IngestDocument[]> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("activity_code", ctx.activityCode);
  // Sem cliente escolhido não há regra de fornecedor: as regras são por cliente,
  // porque a mesma Vodafone vai para contas diferentes em empresas diferentes.
  fd.append("client_id", ctx.clientId || "");
  fd.append("default_credit_unmatched", String(ctx.defaultCreditUnmatched));
  fd.append("related_categories", JSON.stringify(ctx.relatedCategories ?? []));

  const res = await fetch("/api/extract", { method: "POST", body: fd });

  /*
   * PORQUE ISTO NÃO É UM `res.json()` SECO.
   *
   * Era, e foi assim que o utilizador passou a ver a palavra "Error" e mais
   * nada. Quando a rota estoura o tempo, quem responde já não é a aplicação —
   * é a borda da Vercel, com uma página HTML de 504. `res.json()` rebenta a
   * tentar ler `<!DOCTYPE`, o `catch` lá de cima apanha um erro de sintaxe de
   * JSON, e o ecrã mostra isso como se fosse o problema do documento.
   *
   * O contabilista precisa de saber uma coisa só: **vale a pena repetir?**
   * "O documento é ilegível" e "o servidor desistiu" pedem gestos opostos, e
   * antes disto os dois saíam iguais.
   */
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    if (data?.error) throw new Error(data.error);
    if (res.status === 504 || res.status === 408) {
      throw new Error("A leitura demorou demasiado e o servidor desistiu. Tente repetir esta linha — documentos grandes por vezes passam à segunda.");
    }
    if (res.status === 413) {
      throw new Error("O ficheiro é grande demais para ser lido de uma vez. Divida o PDF e tente outra vez.");
    }
    if (res.status === 502 || res.status === 503) {
      throw new Error("O serviço de leitura está indisponível neste momento. Tente repetir daqui a pouco.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("A sessão expirou ou não tem acesso a este cliente. Entre de novo e repita.");
    }
    throw new Error(`A leitura falhou (erro ${res.status}). Tente repetir esta linha.`);
  }

  const docs: IngestDocument[] = data?.documents || [];
  // Resposta 200 sem documentos: o servidor respondeu, portanto repetir é
  // inútil — o problema está no ficheiro.
  if (!docs.length) throw new Error("Nada foi reconhecido neste ficheiro. Confirme que é mesmo uma fatura ou recibo legível.");
  return docs;
}

/** Um PDF dividido volta em base64; vira arquivo para poder ser gravado sozinho. */
export function base64ToFile(b64: string, filename: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: "application/pdf" });
}

/**
 * Grava um documento de VENDA — na tabela `sales`, não em `invoices`.
 *
 * Existe porque a fila carrega `direction` desde a camada B2 (e o link de
 * telefone da B4 deixa o cliente marcar "venda"), mas a gravação ignorava
 * isso e mandava tudo para `invoices`. Uma venda virando nota de compra não é
 * erro de tela: o IVA entra como CRÉDITO em vez de DÉBITO, então o VAT3 sai
 * subestimado nos dois sentidos ao mesmo tempo — some do T1 e ainda abate
 * indevidamente no T2.
 *
 * Uma entrada por documento, a partir dos TOTAIS do cabeçalho: `sales` é
 * razão de resumo (data, documento, cliente, líquido, taxa, IVA) e não guarda
 * linha de item. Quebrar as linhas do documento aqui inventaria vendas que o
 * documento não declara.
 */
export async function saveSaleDocument(
  file: File, doc: IngestDocument,
  ctx: { clientId: string; postingDate: string; source?: string | null; capturedAt?: string | null }
): Promise<{ kind: "saved"; id: string } | { kind: "error"; error: string }> {
  const h = doc.header;
  // A taxa do cabeçalho quando ela é única e explícita; senão fica nula e o
  // contador preenche. Deduzir de IVA/líquido daria um número plausível e
  // errado nos documentos com mais de uma alíquota, normal no varejo.
  const rates = Array.from(new Set(doc.items.map((i) => i.vat_rate_on_invoice).filter((r): r is number => r != null)));

  const meta = {
    entry_date: h.invoice_date || ctx.postingDate,
    doc_number: h.invoice_number ?? null,
    // Numa venda quem emite é o cliente do escritório, então o nome lido no
    // documento é o COMPRADOR — vai para `customer`, não para fornecedor.
    customer: h.supplier_name ?? null,
    net_amount: h.total_net,
    vat_rate: rates.length === 1 ? rates[0] : null,
    vat_amount: h.total_vat ?? 0,
    source: ctx.source ?? null,
    captured_at: ctx.capturedAt ?? null,
    doc_kind: doc.header.doc_kind ?? null,
    original_filename: doc.filename,
    needs_review: doc.needs_review,
    confidence: doc.confidence,
    // As linhas lidas. Vazio aqui vira UMA linha genérica no servidor — ver
    // saveSaleFromDocument em lib/store.ts.
    items: doc.items.map((it) => ({
      description: it.description,
      quantity: it.quantity, unit_price: it.unit_price,
      net_amount: it.net_amount,
      vat_rate: it.vat_rate_on_invoice ?? it.expected_vat_rate ?? null,
      vat_amount: it.vat_amount_on_invoice ?? null,
    })),
  };

  const fd = new FormData();
  fd.append("file", file);
  fd.append("meta", JSON.stringify(meta));

  const res = await fetch(`/api/clients/${ctx.clientId}/sales/document`, { method: "POST", body: fd });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { kind: "error", error: data?.error || "Save failed" };
  return { kind: "saved", id: data.sale.id };
}

export interface SaveContext {
  clientId: string;
  branchId: string;
  activityCode: string;
  postingDate: string;
  /**
   * Por onde o documento entrou. A tela de leitura manda "upload"; a caixa de
   * entrada manda o `source` do próprio item da fila ("email" ou "phone"),
   * para a origem sobreviver à gravação. Ver 013_invoice_source.sql.
   */
  source?: string | null;
  /**
   * Quando o documento CHEGOU. Vem da fila (`received_at`) porque o e-mail de
   * sábado só é lançado na segunda — sem isto a nota registraria a segunda, e
   * a pergunta "chegou antes do fechamento?" ficaria sem resposta.
   */
  capturedAt?: string | null;
  force?: boolean;
}

export type DuplicateMatch = {
  id: string; invoice_number: string | null; posting_date: string | null; total_gross: number | null;
};

export type SaveResult =
  | { kind: "saved"; id: string }
  | { kind: "duplicate"; existing: DuplicateMatch | null };

/**
 * Junta o documento desta duplicata ao lançamento que já existe (camada B3).
 *
 * É o oposto do que o sistema fazia: a segunda cópia era descartada, e com ela a
 * foto que muitas vezes está mais legível que a primeira. Nada do lançamento
 * muda — nem valor, nem crédito.
 */
export async function mergeIntoExisting(
  file: File, invoiceId: string, note?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fd = new FormData();
  fd.append("file", file);
  if (note) fd.append("note", note);
  const res = await fetch(`/api/invoices/${invoiceId}/documents`, { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || "Não foi possível juntar o documento." };
  return { ok: true };
}

export async function saveDocument(
  file: File, doc: IngestDocument, ctx: SaveContext
): Promise<SaveResult> {
  const h = doc.header;
  const meta = {
    client_id: ctx.clientId || null,
    branch_id: ctx.branchId || null,
    source: ctx.source ?? null,
    captured_at: ctx.capturedAt ?? null,
    doc_kind: doc.header.doc_kind ?? null,
    activity_code: ctx.activityCode,
    engine: doc.engine,
    original_filename: doc.filename,
    confidence: doc.confidence,
    needs_review: doc.needs_review,
    issues: doc.issues,
    audit: doc.audit,
    header: {
      supplier_name: h.supplier_name, store_name: h.store_name ?? null, supplier_vat: h.supplier_vat,
      invoice_number: h.invoice_number, barcode: h.barcode ?? null, invoice_date: h.invoice_date,
      posting_date: ctx.postingDate || null,
      invoice_time: h.invoice_time ?? null, doc_type: h.doc_type,
      total_net: h.total_net, total_vat: h.total_vat, total_gross: h.total_gross,
    },
    items: doc.items.map((it) => ({
      description: it.description, quantity: it.quantity, unit_price: it.unit_price,
      net_amount: it.net_amount, vat_rate_on_invoice: it.vat_rate_on_invoice,
      vat_amount_on_invoice: it.vat_amount_on_invoice, expected_vat_rate: it.expected_vat_rate,
      category_code: it.matched_category?.code ?? null,
      category_name: it.matched_category?.description ?? null,
      take_credit: !!it.take_credit,
      // A conta vem decidida pela regra de fornecedor; sem ela, a gravação
      // pergunta à memória item→conta (camada B1).
      account_code: it.account_code ?? null, account_name: it.account_name ?? null,
    })),
  };

  const fd = new FormData();
  fd.append("file", file);
  fd.append("meta", JSON.stringify(meta));
  if (ctx.force) fd.append("force", "true");

  const res = await fetch("/api/invoices", { method: "POST", body: fd });
  const data = await res.json();
  if (res.status === 409 && data.error === "duplicate") {
    return { kind: "duplicate", existing: data.existing ?? null };
  }
  if (!res.ok) throw new Error(data.error || "Save failed");
  return { kind: "saved", id: data.invoice.id };
}
