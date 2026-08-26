import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { checkupDoCliente } from "@/lib/accounting/inconsistencias";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Percorre razao, titulos, documentos e plano do cliente inteiro.
export const maxDuration = 60;

/** A varredura a pedido — ver lib/accounting/inconsistencias.ts. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  return NextResponse.json(await checkupDoCliente(params.id));
}
