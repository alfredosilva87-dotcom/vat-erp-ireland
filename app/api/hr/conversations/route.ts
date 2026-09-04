import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { visibleClientIds } from "@/lib/access";
import { getServerSupabase } from "@/lib/supabase";
import { currentIsoWeek } from "@/lib/hr/payroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A LISTA DE CONVERSAS — quem falou, quando, e quem ainda não falou.
 *
 * ---------------------------------------------------------------------------
 * A PERGUNTA QUE ESTA ROTA RESPONDE
 *
 * "Quem é que ainda não mandou as horas desta semana?" — feita à sexta-feira,
 * e hoje respondida de cabeça, a percorrer conversas no telemóvel. Um cliente
 * esquecido só se descobre quando a folha não fecha.
 *
 * Por isso a lista não é ordenada por nome: vem primeiro quem NÃO mandou nada
 * esta semana. A ordem do ecrã é a ordem do trabalho que falta.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const year = Number(q.get("year")) || new Date().getFullYear();
  const week = Number(q.get("week")) || currentIsoWeek();

  const sb = getServerSupabase();

  /*
   * SÓ os clientes que este utilizador pode ver.
   *
   * Uma lista de conversas é uma lista de clientes — e listar clientes de outra
   * empresa aqui furava o mesmo isolamento que todas as outras telas respeitam,
   * por uma porta lateral.
   */
  const permitidos = await visibleClientIds();
  if (permitidos && "error" in (permitidos as any)) return (permitidos as any).error;
  const ids0 = permitidos as string[] | null;
  if (ids0 && !ids0.length) return NextResponse.json({ year, week, clientes: [] });

  let pergunta = sb.from("clients")
    .select("id,client_code,name,phone,email,status")
    .order("name");
  if (ids0) pergunta = pergunta.in("id", ids0);
  const { data: clientes, error } = await pergunta;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = ((clientes ?? []) as any[]).map((c) => c.id);
  if (!ids.length) return NextResponse.json({ year, week, clientes: [] });

  const [{ data: mensagens }, { data: fila }] = await Promise.all([
    sb.from("hr_conversation")
      .select("id,client_id,direction,channel,body,year,week_no,queued,created_at")
      .in("client_id", ids).order("created_at", { ascending: false }).limit(2000),
    sb.from("hr_hour_submissions")
      .select("client_id,status").in("client_id", ids).eq("year", year).eq("week_no", week),
  ]);

  const ultima = new Map<string, any>();
  const daSemana = new Map<string, number>();
  for (const m of ((mensagens ?? []) as any[])) {
    // Já vêm do mais recente para o mais antigo: a primeira que aparece é a última.
    if (!ultima.has(m.client_id)) ultima.set(m.client_id, m);
    if (m.direction === "in" && m.year === year && m.week_no === week) {
      daSemana.set(m.client_id, (daSemana.get(m.client_id) ?? 0) + 1);
    }
  }
  const naFila = new Map<string, number>();
  for (const s of ((fila ?? []) as any[])) {
    if (s.status !== "pending") continue;
    naFila.set(s.client_id, (naFila.get(s.client_id) ?? 0) + 1);
  }

  const lista = ((clientes ?? []) as any[]).map((c) => ({
    id: c.id, client_code: c.client_code, name: c.name,
    phone: c.phone, email: c.email, status: c.status,
    ultima: ultima.get(c.id) ?? null,
    recebidasNaSemana: daSemana.get(c.id) ?? 0,
    pendentesNaFila: naFila.get(c.id) ?? 0,
  }));

  // Quem não mandou nada esta semana primeiro; depois por mensagem mais recente.
  lista.sort((a, b) => {
    if ((a.recebidasNaSemana > 0) !== (b.recebidasNaSemana > 0)) return a.recebidasNaSemana ? 1 : -1;
    const ta = a.ultima?.created_at ?? "";
    const tb = b.ultima?.created_at ?? "";
    return tb.localeCompare(ta);
  });

  return NextResponse.json({ year, week, clientes: lista });
}
