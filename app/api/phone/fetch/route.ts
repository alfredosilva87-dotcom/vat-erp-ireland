import { NextResponse } from "next/server";
import { fetchPhoneOnce, listPhoneFetches } from "@/lib/phoneFetch";
import { relayConfigured } from "@/lib/relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Quarenta fotos de até 4 MB baixadas da nuvem e regravadas passam dos dez
// segundos padrão. O FETCH_LIMIT é o que garante o fim; o tempo maior só evita
// que a volta seja cortada no meio, o que deixaria arquivo na passagem.
export const maxDuration = 120;

/**
 * A busca das fotos que os clientes mandaram. RODA NO ESCRITÓRIO.
 *
 * Fica atrás do middleware como a busca de e-mail: é operação do escritório, e
 * quem a dispara tem sessão. Não confundir com `/api/phone/upload`, que é a ponta
 * pública na nuvem.
 */

export async function GET() {
  return NextResponse.json({
    configured: relayConfigured(),
    fetches: await listPhoneFetches(),
  });
}

export async function POST() {
  const outcome = await fetchPhoneOnce();
  // 200 mesmo com erro, como na busca de e-mail: o resultado é dado, não falha de
  // rota. Um 500 esconderia o que entrou antes de o problema aparecer.
  return NextResponse.json(outcome);
}
