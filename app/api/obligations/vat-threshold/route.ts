import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { visibleClientIds } from "@/lib/access";
import { limiarDeTodos } from "@/lib/fiscal/limiarVat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Varre as vendas de doze meses de todos os clientes nao registados.
export const maxDuration = 60;

/**
 * Quem está a passar o limiar de registo de VAT — ver lib/fiscal/limiarVat.ts.
 *
 * Rota separada da agenda de propósito: aquela lê prazos e responde depressa,
 * esta varre vendas. Juntá-las faria a agenda — que se abre todos os dias —
 * esperar pela varredura, e uma tela lenta é uma tela que se deixa de abrir.
 */
export async function GET(_req: NextRequest) {
  // O recorte por empresa vem de lib/access.ts, como na agenda: sem ele esta
  // rota devolveria o faturamento dos clientes de outro escritorio.
  const permitidos = await visibleClientIds();
  if (permitidos && "error" in permitidos) return permitidos.error;

  const sb = getServerSupabase();
  let qc = sb.from("clients").select("id");
  if (permitidos) qc = qc.in("id", permitidos as string[]);
  const { data: clientes, error } = await qc;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(await limiarDeTodos(((clientes ?? []) as any[]).map((c) => c.id)));
}
