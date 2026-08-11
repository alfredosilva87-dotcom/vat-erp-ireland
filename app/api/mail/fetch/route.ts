import { NextRequest, NextResponse } from "next/server";
import { fetchMailOnce, readMailConfig } from "@/lib/mailFetch";
import { listMailFetches } from "@/lib/mailStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Uma caixa com cinquenta mensagens e anexos grandes leva mais que os dez
// segundos padrão. O limite da busca (FETCH_LIMIT) é o que garante que isto
// termine; sem ele, aumentar o tempo só adiaria o mesmo problema.
export const maxDuration = 120;

/** Se a entrada por e-mail está configurada, e o histórico das buscas. */
export async function GET() {
  const { config, missing } = readMailConfig();
  return NextResponse.json({
    configured: Boolean(config),
    missing,
    mailbox: config?.mailbox ?? null,
    inbox_address: config?.inboxAddress ?? null,
    fetches: await listMailFetches(),
  });
}

export async function POST(_req: NextRequest) {
  const outcome = await fetchMailOnce();
  // 200 mesmo com erro: o resultado da busca é dado, não falha de rota. Um 500
  // faria a tela mostrar "erro" sem o registro do que chegou antes de quebrar.
  return NextResponse.json(outcome);
}
