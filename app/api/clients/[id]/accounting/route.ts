import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { loadReports, periodoDoAno } from "@/lib/accounting/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Balancete, DRE e balanço de um cliente.
 *
 * A montagem mora em `lib/accounting/query.ts` porque o PDF e o Excel
 * usam exatamente a mesma — o arquivo entregue ao cliente não pode
 * discordar do que a pessoa viu na tela.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sp = new URL(req.url).searchParams;
  const ano = Number(sp.get("year")) || new Date().getFullYear();
  const padrao = periodoDoAno(ano);
  const de = sp.get("from") || padrao.de;
  const ate = sp.get("to") || padrao.ate;

  return NextResponse.json(await loadReports(params.id, de, ate));
}
