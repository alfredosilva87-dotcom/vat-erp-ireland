import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listLicenseEvents } from "@/lib/store";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireRole("master");
  if ("error" in guard) return guard.error;
  return NextResponse.json({ events: await listLicenseEvents(params.id) });
}
