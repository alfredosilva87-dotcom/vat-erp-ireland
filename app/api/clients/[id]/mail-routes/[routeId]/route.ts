import { NextRequest, NextResponse } from "next/server";
import { rotateMailRoute, setMailRouteActive } from "@/lib/mailStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; routeId: string } };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const body = await req.json().catch(() => ({}));

  // Trocar o endereço é o conserto de quando ele vaza para lista de spam:
  // desligar a entrada do cliente inteiro seria punir o cliente pelo vazamento.
  if (body?.rotate) {
    const route = await rotateMailRoute(params.routeId);
    if (!route) return NextResponse.json({ error: "Não foi possível trocar o endereço." }, { status: 500 });
    return NextResponse.json({ route });
  }

  if ("active" in body) {
    const ok = await setMailRouteActive(params.routeId, body.active !== false);
    return NextResponse.json({ ok });
  }
  return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
}
