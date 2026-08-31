import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criarTituloDeImposto, type TipoDeImposto } from "@/lib/fiscal/tituloDeImposto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cria o título a pagar do imposto apurado — ver lib/fiscal/tituloDeImposto.ts. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const b = await req.json().catch(() => ({}));
  const tipo: TipoDeImposto = b?.tipo === "imposto" ? "imposto" : "vat";

  const r = await criarTituloDeImposto({
    clientId: params.id, tipo,
    de: String(b?.de ?? ""), ate: String(b?.ate ?? ""),
    valor: Number(b?.valor ?? 0),
    vencimento: b?.vencimento ?? null,
    // As contas vêm da tela: a do imposto a pagar sempre, a da despesa só no
    // imposto sobre o lucro — e vazia ali significa "já lançado no fecho".
    contaDoImposto: b?.conta_do_imposto ?? null,
    contaDeDespesa: b?.conta_de_despesa ?? null,
    userId: (await getSessionUser())?.id ?? null,
  });

  // 409 e nao 400: o pedido esta certo, o estado e que impede — ja existe um
  // titulo, ou nao ha obrigacao de onde tirar o vencimento. A tela distingue.
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 409 });
  return NextResponse.json(r);
}
