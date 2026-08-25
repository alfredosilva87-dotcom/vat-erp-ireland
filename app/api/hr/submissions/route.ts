import { NextResponse } from "next/server";
import { visibleClientIds } from "@/lib/access";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A fila de horas que os clientes mandaram, à espera de conferência.
 *
 * Rota de LISTA: o escopo vem de `visibleClientIds()`. Nada aqui entrou em
 * conta nenhuma — enquanto uma linha estiver nesta fila não mexe no bruto, não
 * aparece no controlo semanal e não toca nas horas oficiais. É isso que impede
 * um cliente de alterar uma semana já fechada.
 */
export async function GET() {
  const allowed = await visibleClientIds();
  if (allowed !== null && !Array.isArray(allowed)) return allowed.error;

  const sb = getServerSupabase();
  let q = sb
    .from("hr_hour_submissions")
    .select("*")
    .eq("status", "pending")
    .order("submitted_at", { ascending: false });
  if (allowed) {
    // Lista vazia recusaria o filtro `in`, então usa-se um id impossível: quem
    // não pode ver cliente nenhum recebe fila vazia, não a fila inteira.
    q = q.in("client_id", allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"]);
  }
  const { data } = await q;
  const linhas = (data ?? []) as any[];

  // O nome da empresa vem do cadastro raiz, não copiado na submissão: se
  // alguém corrigir o nome do cliente, a fila corrige junto.
  const ids = Array.from(new Set(linhas.map((r) => r.client_id)));
  const nomes = new Map<string, { name: string; code: string | null }>();
  if (ids.length) {
    const { data: cs } = await sb.from("clients").select("id,name,client_code").in("id", ids);
    for (const c of (cs ?? []) as any[]) nomes.set(c.id, { name: c.name, code: c.client_code });
  }

  return NextResponse.json({
    submissions: linhas.map((r) => ({
      ...r,
      client_name: nomes.get(r.client_id)?.name ?? null,
      client_code: nomes.get(r.client_id)?.code ?? null,
    })),
  });
}
