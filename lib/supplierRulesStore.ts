/**
 * Guardar as regras de fornecedor (camada B1).
 *
 * O motor que decide qual regra ganha é `lib/supplierRules.ts`, e é puro de
 * propósito. Aqui só entra o que precisa de banco.
 *
 * A normalização acontece na GRAVAÇÃO, não na leitura: é o que permite o índice
 * único de `007_supplier_rules.sql` recusar "IE 1234567 X" contra "ie1234567x".
 * Normalizar na leitura deixaria a unicidade furada exatamente no caso que ela
 * existe para pegar.
 */

import { getServerSupabase } from "@/lib/supabase";
import { nameKey, vatKey, type SupplierRule } from "@/lib/supplierRules";

const sb = () => getServerSupabase();

const text = (v: unknown, max = 200): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/** Um pedaço de nome, na forma comparável. Nulo quando vazio. */
const cleanName = (v: unknown): string | null => {
  const s = nameKey(v).slice(0, 120);
  return s || null;
};
const cleanVat = (v: unknown): string | null => {
  const s = vatKey(v).slice(0, 40);
  return s || null;
};

export async function listSupplierRules(clientId: string): Promise<SupplierRule[]> {
  const { data } = await sb()
    .from("supplier_rules").select("*").eq("client_id", clientId)
    .order("label");
  return (data ?? []) as SupplierRule[];
}

export interface SupplierRuleError {
  error: string;
}

/**
 * Erro de índice único devolvido em português, com o motivo.
 *
 * "duplicate key value violates unique constraint" na tela é o mesmo que não
 * dizer nada: quem cadastrou não sabe se repetiu o número, o nome, ou se o
 * sistema quebrou.
 */
function friendlyError(err: any): string {
  const msg = String(err?.message || "");
  if (err?.code === "23505" || msg.includes("duplicate key")) {
    if (msg.includes("idx_supplier_rules_vat")) return "Já existe uma regra para este número de VAT.";
    if (msg.includes("idx_supplier_rules_name")) return "Já existe uma regra para este pedaço de nome.";
    return "Já existe uma regra igual a esta.";
  }
  if (msg.includes("supplier_rules_needs_identifier")) {
    return "Diga como reconhecer o fornecedor: o número de VAT, um pedaço do nome, ou os dois.";
  }
  return msg || "Erro ao salvar a regra.";
}

export async function createSupplierRule(
  clientId: string, input: any
): Promise<{ rule?: SupplierRule; error?: string }> {
  const label = text(input?.label, 120);
  if (!label) return { error: "Dê um nome à regra." };

  const supplier_vat = cleanVat(input?.supplier_vat);
  const name_match = cleanName(input?.name_match);
  if (!supplier_vat && !name_match) {
    return { error: "Diga como reconhecer o fornecedor: o número de VAT, um pedaço do nome, ou os dois." };
  }

  const row = {
    client_id: clientId,
    label,
    supplier_vat,
    name_match,
    account_code: text(input?.account_code, 40),
    account_name: text(input?.account_name, 200),
    vat_category_code: text(input?.vat_category_code, 40),
    extract_line_items: input?.extract_line_items !== false,
    active: input?.active !== false,
  };

  const { data, error } = await sb().from("supplier_rules").insert(row).select().single();
  if (error) return { error: friendlyError(error) };
  return { rule: data as SupplierRule };
}

export async function updateSupplierRule(
  id: string, patch: any
): Promise<{ rule?: SupplierRule; error?: string }> {
  const row: Record<string, unknown> = {};
  if ("label" in patch) { const l = text(patch.label, 120); if (l) row.label = l; }
  if ("supplier_vat" in patch) row.supplier_vat = cleanVat(patch.supplier_vat);
  if ("name_match" in patch) row.name_match = cleanName(patch.name_match);
  if ("account_code" in patch) row.account_code = text(patch.account_code, 40);
  if ("account_name" in patch) row.account_name = text(patch.account_name, 200);
  if ("vat_category_code" in patch) row.vat_category_code = text(patch.vat_category_code, 40);
  if ("extract_line_items" in patch) row.extract_line_items = patch.extract_line_items !== false;
  if ("active" in patch) row.active = patch.active !== false;
  if (!Object.keys(row).length) return {};

  // Apagar as duas formas de reconhecimento de uma vez deixaria uma regra que
  // casa com todo mundo ou com ninguém. O banco também recusa (check
  // constraint); recusar aqui é para a mensagem sair legível.
  if (("supplier_vat" in row || "name_match" in row)) {
    const { data: cur } = await sb()
      .from("supplier_rules").select("supplier_vat,name_match").eq("id", id).maybeSingle();
    const nextVat = "supplier_vat" in row ? row.supplier_vat : (cur as any)?.supplier_vat;
    const nextName = "name_match" in row ? row.name_match : (cur as any)?.name_match;
    if (!nextVat && !nextName) {
      return { error: "Diga como reconhecer o fornecedor: o número de VAT, um pedaço do nome, ou os dois." };
    }
  }

  row.updated_at = new Date().toISOString();
  const { data, error } = await sb().from("supplier_rules").update(row).eq("id", id).select().maybeSingle();
  if (error) return { error: friendlyError(error) };
  return { rule: (data as SupplierRule) ?? undefined };
}

export async function deleteSupplierRule(id: string): Promise<boolean> {
  const { error } = await sb().from("supplier_rules").delete().eq("id", id);
  return !error;
}
