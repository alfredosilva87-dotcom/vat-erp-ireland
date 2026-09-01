import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { requireRole, getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { lerPartida, ajustarLancamento } from "@/lib/accounting/ajuste";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A partida de um documento — para ler, e para ajustar.
 *
 * O ajuste é estorno + relançamento, nunca um `update` por cima: um lançamento
 * reescrito não deixa rasto, e "não perder o rastro" era metade do pedido.
 * Ver `lib/accounting/ajustePuro.ts`.
 */

export async function GET(_req: NextRequest, { params }: { params: { id: string; journalId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const partida = await lerPartida(params.id, params.journalId);
  if (!partida) return NextResponse.json({ error: "Not found." }, { status: 404 });

  /*
   * O plano vai JUNTO com a partida, numa volta só.
   *
   * A tela precisa das duas coisas ao mesmo tempo para desenhar o seletor de
   * conta em cada linha, e duas chamadas fariam o painel abrir com as contas em
   * branco e preenchê-las depois — o tempo suficiente para alguém escolher no
   * seletor vazio.
   */
  const sb = getServerSupabase();
  const { data: plano } = await sb.from("chart_of_accounts")
    .select("code,description,type,active,postable")
    .or(`client_id.is.null,client_id.eq.${params.id}`)
    .order("code", { ascending: true });

  return NextResponse.json({
    partida,
    contas: ((plano ?? []) as any[])
      .filter((c) => c.active && c.postable && c.type)
      .map((c) => ({ code: c.code, name: c.description, type: c.type })),
  });
}

/** Ajustar. ADMIN: reescrever o efeito de um documento no razão não é edição de rotina. */
export async function POST(req: NextRequest, { params }: { params: { id: string; journalId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  const linhas = Array.isArray(body?.lines) ? body.lines : [];
  const nota = String(body?.note || "").trim();

  // Mesma razão da tela de Limpeza: um lançamento que muda sem uma frase a
  // dizer porquê volta a ser o mistério que isto existe para acabar.
  if (nota.length < 3) {
    return NextResponse.json(
      { error: "Escreva porque está a ajustar — fica no registo, ao lado do lançamento original." },
      { status: 400 }
    );
  }

  const user = await getSessionUser();
  const r = await ajustarLancamento({
    clientId: params.id, journalId: params.journalId,
    linhas, nota, userId: user?.id ?? null,
  });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json(r);
}
