import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { visibleClientIds } from "@/lib/access";
import { montarPainel, resumo, type ObrigacaoBruta } from "@/lib/fiscal/agenda";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A agenda fiscal de TODOS os clientes visiveis.
 *
 * Junta as obrigacoes apuradas (`obligations`: VAT3 e RTD) com as que o
 * escritorio criou a mao (`recurring_obligations`), porque para quem olha a
 * agenda as duas sao a mesma coisa — um prazo a cumprir. Ver lib/fiscal/agenda.ts.
 */
export async function GET(_req: NextRequest) {
  // O recorte por empresa vem de lib/access.ts: sem ele esta rota devolveria
  // a agenda de todos os escritorios da instalacao.
  const permitidos = await visibleClientIds();
  if (permitidos && "error" in permitidos) return permitidos.error;

  const sb = getServerSupabase();
  let qc = sb.from("clients").select("id,client_code,name,status");
  if (permitidos) qc = qc.in("id", permitidos as string[]);
  const { data: clientes, error } = await qc;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = ((clientes ?? []) as any[]).map((c) => c.id);
  if (!ids.length) return NextResponse.json({ resumo: resumo([]), linhas: [] });

  const [{ data: apuradas }, { data: manuais }] = await Promise.all([
    sb.from("obligations").select("id,client_id,kind,period_label,due_date,status").in("client_id", ids),
    sb.from("recurring_obligations").select("id,client_id,name,periodicity,due_date,status").in("client_id", ids),
  ]);

  const obrigacoes: ObrigacaoBruta[] = [
    ...((apuradas ?? []) as any[]).map((o) => ({
      id: o.id, clientId: o.client_id, tipo: o.kind,
      periodo: o.period_label ?? null, vencimento: o.due_date ?? null,
      entregue: o.status === "filed",
    })),
    ...((manuais ?? []) as any[]).map((o) => ({
      id: o.id, clientId: o.client_id, tipo: o.name,
      periodo: o.periodicity ?? null, vencimento: o.due_date ?? null,
      // A obrigacao manual usa 'active' como "por fazer"; qualquer outro
      // estado conta como tratada.
      entregue: !(o.status === "active" || o.status === "open"),
    })),
  ];

  const hoje = new Date().toISOString().slice(0, 10);
  const linhas = montarPainel(
    ((clientes ?? []) as any[]).map((c) => ({ id: c.id, code: c.client_code, name: c.name })),
    obrigacoes, hoje
  );
  return NextResponse.json({ hoje, resumo: resumo(linhas), linhas });
}
