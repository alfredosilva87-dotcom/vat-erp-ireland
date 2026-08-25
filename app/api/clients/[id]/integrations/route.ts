import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { CHAVES, gravarIntegracoes, integracoesDo, type Integracoes } from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** O que este cliente integra. Ausência de linha = tudo ligado. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  return NextResponse.json(await integracoesDo(params.id));
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const body = await req.json().catch(() => ({}));
  const patch: Partial<Integracoes> = {};
  // Só booleanos, e só as chaves conhecidas: um campo a mais vindo do corpo
  // não pode criar coluna nem apagar a que existe.
  for (const k of CHAVES) if (typeof body?.[k] === "boolean") patch[k] = body[k];
  if (Object.keys(patch).length === 0) return NextResponse.json(await integracoesDo(params.id));

  const user = await getSessionUser();
  try {
    return NextResponse.json(await gravarIntegracoes(params.id, patch, user?.id ?? null));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falhou." }, { status: 500 });
  }
}
