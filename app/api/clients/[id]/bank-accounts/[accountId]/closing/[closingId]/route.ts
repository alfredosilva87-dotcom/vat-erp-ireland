import { NextRequest, NextResponse } from "next/server";
import { getBankAccount } from "@/lib/bankStore";
import { reopenClosing } from "@/lib/bankClosingStore";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; accountId: string; closingId: string } };

/**
 * Reabrir um período fechado.
 *
 * Só administrador: fechar é rotina, reabrir é exceção. O fechamento é o que o
 * escritório mostra como prova de que o mês bate — apagá-lo por engano no meio
 * de outro trabalho é o tipo de coisa que ninguém percebe até a auditoria.
 */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const account = await getBankAccount(params.accountId);
  if (!account || account.client_id !== params.id) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }
  return NextResponse.json({ ok: await reopenClosing(params.closingId) });
}
