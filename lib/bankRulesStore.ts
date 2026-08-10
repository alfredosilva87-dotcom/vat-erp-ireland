/**
 * Guardar e ordenar as regras de banco (camada A3).
 *
 * A tabela nasceu na camada A0 (`bank_rules`), já com `priority`, porque a
 * ordem é parte do significado da regra e não um enfeite da tela.
 *
 * O motor que decide qual regra ganha é `lib/bankRules.ts`, e é puro de
 * propósito. Aqui só entra o que precisa de banco.
 */

import { getServerSupabase } from "@/lib/supabase";
import type { BankRule, RuleAllocation, RuleCondition } from "@/lib/bankRules";

const sb = () => getServerSupabase();

const text = (v: unknown, max = 200): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const FIELDS = new Set(["description", "payee", "reference", "amount"]);
const OPS = new Set(["contains", "equals", "starts_with", "gt", "lt"]);

/** Condição vinda do navegador não é confiável até passar por aqui. */
function cleanConditions(input: unknown): RuleCondition[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((c: any) => ({
      field: FIELDS.has(c?.field) ? c.field : "description",
      op: OPS.has(c?.op) ? c.op : "contains",
      value: String(c?.value ?? "").trim().slice(0, 200),
    }))
    .filter((c) => c.value) as RuleCondition[];
}

function cleanAllocations(input: unknown): RuleAllocation[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((a: any) => ({
      account_code: text(a?.account_code, 40),
      vat_rate: num(a?.vat_rate),
      percent: a?.percent === "" || a?.percent == null ? null : num(a.percent),
      amount: a?.amount === "" || a?.amount == null ? null : num(a.amount),
      description: text(a?.description, 200),
    }))
    .filter((a) => a.account_code || a.percent != null || a.amount != null);
}

export async function listBankRules(clientId: string): Promise<BankRule[]> {
  const { data } = await sb()
    .from("bank_rules").select("*").eq("client_id", clientId)
    .order("priority").order("created_at");
  return (data ?? []) as BankRule[];
}

export async function createBankRule(clientId: string, input: any): Promise<BankRule | null> {
  const name = text(input?.name, 120);
  if (!name) return null;

  // Regra nova entra no FIM da fila. Entrar no topo faria dela a primeira a
  // casar, engolindo em silêncio o que já estava configurado e funcionando.
  const { data: last } = await sb()
    .from("bank_rules").select("priority").eq("client_id", clientId)
    .order("priority", { ascending: false }).limit(1).maybeSingle();
  const priority = ((last as any)?.priority ?? 0) + 10;

  const row = {
    client_id: clientId,
    bank_account_id: input?.bank_account_id || null,
    name,
    priority,
    match_all: input?.match_all !== false,
    conditions: cleanConditions(input?.conditions),
    allocations: cleanAllocations(input?.allocations),
    contact_name: text(input?.contact_name, 120),
    active: input?.active !== false,
  };
  const { data, error } = await sb().from("bank_rules").insert(row).select().single();
  if (error) throw error;
  return data as BankRule;
}

export async function updateBankRule(id: string, patch: any): Promise<BankRule | null> {
  const row: Record<string, unknown> = {};
  if ("name" in patch) { const n = text(patch.name, 120); if (n) row.name = n; }
  if ("bank_account_id" in patch) row.bank_account_id = patch.bank_account_id || null;
  if ("match_all" in patch) row.match_all = patch.match_all !== false;
  if ("conditions" in patch) row.conditions = cleanConditions(patch.conditions);
  if ("allocations" in patch) row.allocations = cleanAllocations(patch.allocations);
  if ("contact_name" in patch) row.contact_name = text(patch.contact_name, 120);
  if ("active" in patch) row.active = patch.active !== false;
  if ("priority" in patch) { const p = num(patch.priority); if (p != null) row.priority = Math.round(p); }
  if (!Object.keys(row).length) return null;

  const { data } = await sb().from("bank_rules").update(row).eq("id", id).select().maybeSingle();
  return (data as BankRule) ?? null;
}

export async function deleteBankRule(id: string): Promise<boolean> {
  const { error } = await sb().from("bank_rules").delete().eq("id", id);
  return !error;
}

/**
 * Move uma regra uma posição para cima ou para baixo.
 *
 * Troca as prioridades das duas em vez de renumerar tudo: é uma operação só, e
 * não mexe na ordem de regras que ninguém pediu para mexer.
 */
export async function moveBankRule(
  clientId: string, id: string, direction: "up" | "down"
): Promise<{ ok: boolean; error?: string }> {
  const rules = await listBankRules(clientId);
  const i = rules.findIndex((r) => r.id === id);
  if (i < 0) return { ok: false, error: "Regra não encontrada." };
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= rules.length) return { ok: true }; // já está na ponta

  const a = rules[i];
  const b = rules[j];
  // Prioridades empatadas existiriam se duas regras nascessem juntas; sem este
  // ajuste a troca não moveria nada e o botão pareceria quebrado.
  const pa = a.priority === b.priority ? a.priority + (direction === "up" ? 1 : -1) : b.priority;
  const pb = a.priority === b.priority ? b.priority + (direction === "up" ? -1 : 1) : a.priority;

  await sb().from("bank_rules").update({ priority: pa }).eq("id", a.id);
  await sb().from("bank_rules").update({ priority: pb }).eq("id", b.id);
  return { ok: true };
}
