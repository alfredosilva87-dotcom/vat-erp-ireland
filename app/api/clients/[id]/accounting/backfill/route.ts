import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { backfillClient } from "@/lib/accounting/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Contabilizar centenas de documentos passa dos 10s padrão da Vercel.
export const maxDuration = 300;

/**
 * Contabiliza retroativamente tudo o que já está no banco.
 *
 * Rodar de novo é seguro: cada documento que já tem lançamento é
 * saltado. É o que permite chamar isto depois de importar mais notas,
 * ou depois de corrigir uma regra de classificação, sem medo de dobrar
 * a despesa.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const user = await getSessionUser();
  const body = await req.json().catch(() => ({}));
  const ate = typeof body?.until === "string" ? body.until : undefined;

  const resumo = await backfillClient(params.id, ate, user?.id ?? null);
  return NextResponse.json(resumo);
}
