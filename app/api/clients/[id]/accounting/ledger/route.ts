import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { contasPedidas, loadLedger, recorte } from "@/lib/accounting/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Um razão de ano inteiro num cliente com movimento passa dos 10s padrão.
export const maxDuration = 120;

/**
 * O razão de um cliente, no recorte de datas pedido.
 *
 * `from`/`to` são o ponto da tela: concilia-se um mês ou uma semana, não um
 * exercício. `accounts` escolhe as contas; sem ele vêm todas as que têm o que
 * mostrar. `year` só serve de omissão quando não vem data nenhuma.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sp = new URL(req.url).searchParams;
  const { de, ate } = recorte(sp);
  if (de > ate) {
    return NextResponse.json({ error: "A data inicial e depois da final." }, { status: 400 });
  }
  return NextResponse.json(await loadLedger(params.id, de, ate, contasPedidas(sp)));
}
