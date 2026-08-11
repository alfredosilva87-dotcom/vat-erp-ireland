import { NextRequest, NextResponse } from "next/server";
import { readDocuments } from "@/lib/extractor";
import type { SplitDocument } from "@/lib/extractor";
import { classifyItems } from "@/lib/extractor/gemini";
import { analyzeItem, applyCategoryFromSource, creditRiskSummary, categoryRelationSummary } from "@/lib/matching";
import type { CreditContext } from "@/lib/matching";
import { loadBase } from "@/lib/loadBase";
import { lookupMasterCategories } from "@/lib/store";
import { listSupplierRules } from "@/lib/supplierRulesStore";
import { collapseToSingleLine, matchSupplierRule, type SupplierRule } from "@/lib/supplierRules";
import type { AnalyzedItem, ExtractionResult, RawItem, VatCategory } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACCEPTED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const hasGemini = () => Boolean(process.env.GEMINI_API_KEY);

/**
 * Decide o destino das linhas de um documento.
 *
 * A ordem é a precedência da camada B1, e é a razão de ser deste bloco:
 * **regra de fornecedor > aprendido > IA**. A escolha manual do contador não
 * aparece aqui porque acontece depois, na tela da nota, e por isso ganha de
 * tudo naturalmente.
 *
 * Quando a regra resolve o documento, os dois passos caros — a memória e a
 * classificação por IA — nem são chamados. É onde a economia prometida pelo
 * interruptor de itens de linha realmente aparece.
 */
async function classifyDocument(
  extraction: ExtractionResult,
  categories: VatCategory[],
  creditCtx: CreditContext,
  relatedCategories: string[],
  supplierRules: SupplierRule[]
) {
  const invoiceDate = extraction.data.invoice_date;
  const identity = {
    supplier_name: extraction.data.supplier_name,
    store_name: extraction.data.store_name,
    supplier_vat: extraction.data.supplier_vat,
  };

  const byRef = new Map<string, VatCategory>();
  categories.forEach((c) => byRef.set(c.code || c.id, c));

  const outcome = matchSupplierRule(identity, supplierRules);
  const rule = outcome.rule;
  const ruleCategory = rule?.vat_category_code ? byRef.get(rule.vat_category_code) : undefined;

  // Fornecedor com itens desligados: o documento entra como UMA linha, com os
  // totais do próprio documento. Trocar as linhas ANTES de classificar é o que
  // faz a economia existir — depois já teria custado a chamada de IA.
  const collapsed = Boolean(rule) && rule!.extract_line_items === false;
  const rawItems: RawItem[] = collapsed
    ? [
        {
          ...collapseToSingleLine(
            identity,
            {
              total_net: extraction.data.total_net,
              total_vat: extraction.data.total_vat,
              total_gross: extraction.data.total_gross,
            },
            ruleCategory?.vat_rate ?? null
          ),
        },
      ]
    : extraction.data.items;

  let items: AnalyzedItem[] = rawItems.map((it) => analyzeItem(it, invoiceDate, creditCtx, categories));

  // A categoria da regra vale para o documento inteiro e sobrepõe o que o
  // casamento por palavra tinha achado. É decisão explícita contra dedução
  // sobre o texto do item — e a tela de regras avisa que deixar a categoria em
  // branco é o certo para fornecedor cujas notas misturam alíquotas.
  if (ruleCategory) {
    items = items.map((it) => applyCategoryFromSource(it, ruleCategory, "supplier_rule", invoiceDate, creditCtx));
  }

  const unmatched = () => items.map((it, i) => (it.matched_category ? -1 : i)).filter((i) => i >= 0);

  let cacheUsed = 0;
  {
    const idxs = unmatched();
    if (idxs.length) {
      const learned = await lookupMasterCategories(idxs.map((i) => items[i].description));
      idxs.forEach((idx, k) => {
        const code = learned[k];
        const cat = code ? byRef.get(code) : undefined;
        if (cat) {
          items[idx] = applyCategoryFromSource(items[idx], cat, "learned", invoiceDate, creditCtx);
          cacheUsed++;
        }
      });
    }
  }

  let aiUsed = 0;
  // Itens desligados quer dizer desligados: a linha única é o fornecedor, e
  // pedir à IA para categorizar o nome do fornecedor seria pagar pela chamada
  // que o interruptor existe para evitar.
  if (hasGemini() && !collapsed) {
    const idxs = unmatched();
    if (idxs.length) {
      const catRefs = categories.map((c) => ({ ref: c.code || c.id, description: c.description, vat_rate: c.vat_rate }));
      try {
        const codes = await classifyItems(idxs.map((i) => items[i].description), catRefs);
        idxs.forEach((idx, k) => {
          const cat = codes[k] ? byRef.get(codes[k]!) : undefined;
          if (cat) {
            items[idx] = applyCategoryFromSource(items[idx], cat, "ai", invoiceDate, creditCtx);
            aiUsed++;
          }
        });
      } catch {
        /* AI is best-effort; keep prior results on failure */
      }
    }
  }

  // A conta contábil da regra viaja com o item até a gravação, que respeita a
  // precedência: conta que já veio decidida não é sobrescrita pela memória
  // item→conta (ver saveInvoice em lib/store.ts).
  if (rule?.account_code) {
    items = items.map((it) => ({ ...it, account_code: rule.account_code, account_name: rule.account_name }));
  }

  const risk = creditRiskSummary(items);
  const relation = categoryRelationSummary(items, relatedCategories);

  // Conflito de regras é dito no documento, não só na tela de regras: é aqui
  // que o contador percebe que a nota chegou vazia sem motivo aparente.
  const conflictIssue = outcome.conflict.length
    ? [`Duas regras de fornecedor reconhecem este documento e discordam (${outcome.conflict.map((r) => r.label).join(" / ")}) — nenhuma foi aplicada.`]
    : [];

  return {
    engine: extraction.engine,
    confidence: extraction.confidence,
    needs_review: extraction.needs_review || risk.needsReview || relation.needsReview || conflictIssue.length > 0,
    issues: [...extraction.issues, ...risk.issues, ...relation.issues, ...conflictIssue],
    audit: extraction.audit,
    cache_matched: cacheUsed,
    ai_matched: aiUsed,
    supplier_rule: rule
      ? {
          id: rule.id,
          label: rule.label,
          matched_by: outcome.matchedBy,
          account_code: rule.account_code,
          vat_category_code: rule.vat_category_code,
          line_items_off: collapsed,
        }
      : null,
    header: {
      supplier_name: extraction.data.supplier_name,
      store_name: extraction.data.store_name,
      supplier_vat: extraction.data.supplier_vat,
      invoice_number: extraction.data.invoice_number,
      barcode: extraction.data.barcode,
      invoice_date: extraction.data.invoice_date,
      invoice_time: extraction.data.invoice_time,
      doc_type: extraction.data.doc_type,
      total_net: extraction.data.total_net,
      total_vat: extraction.data.total_vat,
      total_gross: extraction.data.total_gross,
    },
    items,
  };
}

function splitFilename(original: string, idx: number, total: number): string {
  const base = original.replace(/\.pdf$/i, "");
  return `${base} (${idx} of ${total}).pdf`;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const activityCode = String(form.get("activity_code") || "*");
    const clientId = String(form.get("client_id") || "");
    const defaultCreditUnmatched = form.get("default_credit_unmatched") === "true";
    let relatedCategories: string[] = [];
    try { relatedCategories = JSON.parse(String(form.get("related_categories") || "[]")); } catch { /* ignore malformed input */ }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    const mimeType = file.type || "application/octet-stream";
    if (!ACCEPTED.includes(mimeType)) {
      return NextResponse.json(
        { error: `Unsupported type "${mimeType}". Upload PDF, PNG, JPEG or WebP.` },
        { status: 415 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Reads the document — transparently splitting a batch PDF (several
    // invoices scanned back-to-back) into one entry per invoice.
    const splitDocs: SplitDocument[] = await readDocuments(buffer, mimeType);
    const { categories, rules, source } = await loadBase();
    const creditCtx: CreditContext = { activityCode, rules, defaultCreditUnmatched };
    // Uma leitura só das regras por requisição, não uma por documento: um PDF
    // com 40 notas dentro tem 40 documentos e um conjunto de regras.
    const supplierRules = clientId ? await listSupplierRules(clientId) : [];

    const documents = await Promise.all(
      splitDocs.map(async (sd, i) => {
        const classified = await classifyDocument(sd.result, categories, creditCtx, relatedCategories, supplierRules);
        return {
          filename: splitDocs.length > 1 ? splitFilename(file.name, i + 1, splitDocs.length) : file.name,
          page_range: sd.page_range,
          pdf_base64: sd.buffer ? sd.buffer.toString("base64") : null,
          base_source: source,
          ...classified,
        };
      })
    );

    return NextResponse.json({ documents });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to read the document." },
      { status: 500 }
    );
  }
}
