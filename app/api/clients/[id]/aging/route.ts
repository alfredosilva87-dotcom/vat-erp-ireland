import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { agingDoCliente } from "@/lib/financial/aging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resumo de pagar/receber e a lista dos parcialmente pagos. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  return NextResponse.json(await agingDoCliente(params.id));
}
