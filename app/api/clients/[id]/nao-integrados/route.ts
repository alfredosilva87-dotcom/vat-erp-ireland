import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { documentosNaoIntegrados } from "@/lib/financial/naoIntegrados";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Percorre compras, vendas, titulos e razao do cliente inteiro.
export const maxDuration = 60;

/** O que nao chegou a contas a pagar/receber, e porque. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  return NextResponse.json(await documentosNaoIntegrados(params.id));
}
