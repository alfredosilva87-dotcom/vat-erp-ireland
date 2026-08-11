import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { approveInvoices } from "@/lib/reviewStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Aprova várias notas de uma vez (camada B3).
 *
 * Aprovar não é destrutivo — não mexe em valor, crédito nem alíquota — então não
 * exige administrador. Desfazer exige (ver `reopen`), pela mesma razão de
 * reabrir período fechado na camada A5: aprovar é rotina, desfazer é exceção.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  const out = await approveInvoices(ids, await getSessionUser());
  if ("error" in out) return NextResponse.json(out, { status: 400 });
  return NextResponse.json(out);
}
