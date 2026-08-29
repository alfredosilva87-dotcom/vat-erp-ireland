import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { leituraDeLimiar } from "@/lib/fiscal/limiarVat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Percorre as vendas de doze meses, paginadas.
export const maxDuration = 60;

/** O faturamento a rolar contra o limiar de registo — ver lib/fiscal/limiarVat.ts. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  return NextResponse.json(await leituraDeLimiar(params.id));
}
