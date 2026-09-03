import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { requireRole, getSessionUser } from "@/lib/auth";
import { montarSubmissao, registarSubmissao } from "@/lib/hr/psr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FREQ = ["weekly", "fortnightly", "monthly"] as const;

function pedido(req: NextRequest, corpo?: any) {
  const q = new URL(req.url).searchParams;
  const freq = String(corpo?.freq ?? q.get("freq") ?? "weekly");
  return {
    year: Number(corpo?.year ?? q.get("year")) || new Date().getFullYear(),
    periodNo: Number(corpo?.period ?? q.get("period")) || 1,
    freqType: (FREQ.includes(freq as any) ? freq : "weekly") as (typeof FREQ)[number],
  };
}

/** A submissão montada e criticada. Não escreve nada. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  return NextResponse.json(await montarSubmissao({ clientId: params.id, ...pedido(req) }));
}

/**
 * REGISTAR que foi comunicada — com o comprovativo do ROS.
 *
 * Não envia nada: o envio é feito pelo ROS, com o certificado digital do
 * escritório. O que se grava aqui é o FACTO de ter sido comunicado, e os
 * valores tal como foram nesse momento.
 *
 * Admin, pela mesma razão que fechar a folha é admin: passa a haver um número
 * comunicado ao Estado, e a partir daí corrigir é uma submissão nova.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const corpo = await req.json().catch(() => ({}));
  const referencia = String(corpo?.rosReference || "").trim();
  if (referencia.length < 3) {
    /*
     * Sem comprovativo não se regista.
     *
     * Um registo sem referência diz "alguém acha que submeteu" — e três meses
     * depois, quando a Revenue diz que não recebeu, não há nada com que
     * responder. É a mesma disciplina do motivo obrigatório ao segurar uma
     * devolução.
     */
    return NextResponse.json(
      { error: "Cole o comprovativo que o ROS devolveu — sem ele o registo nao prova nada." },
      { status: 400 }
    );
  }

  const user = await getSessionUser();
  const r = await registarSubmissao({
    clientId: params.id, ...pedido(req, corpo),
    rosReference: referencia, notes: corpo?.notes ?? null, userId: user?.id ?? null,
  });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 409 });
  return NextResponse.json(r);
}
