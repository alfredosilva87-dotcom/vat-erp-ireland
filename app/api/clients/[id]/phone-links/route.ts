import { NextRequest, NextResponse } from "next/server";
import { createPhoneLink, listPhoneLinks } from "@/lib/phoneLinkStore";
import { captureBaseUrl, relayConfigured } from "@/lib/relay";
import { getSessionUser } from "@/lib/auth";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Os links de envio por telefone deste cliente (camada B4).
 *
 * O endereço da captura vem junto: ele mora no ambiente e não no banco, porque a
 * tela de captura é servida pela nuvem e não por este servidor — sem ele a tela
 * só teria o token, que é metade do que o contador precisa copiar.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  return NextResponse.json({
    links: await listPhoneLinks(params.id),
    captureBase: captureBaseUrl(),
    configured: relayConfigured(),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const body = await req.json().catch(() => ({}));
  const user = await getSessionUser();

  const result = await createPhoneLink({
    clientId: params.id,
    // A empresa vem da SESSÃO, não do corpo do pedido: aceitar do corpo deixaria
    // criar link carimbado com outra empresa.
    companyId: access.companyId,
    person: String(body?.person || ""),
    allowSale: body?.allow_sale === true,
    expiresAt: typeof body?.expires_at === "string" && body.expires_at ? body.expires_at : null,
    createdBy: user?.id ?? null,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({
    link: result.link,
    synced: result.synced,
    // 200 mesmo sem sincronizar: o link existe, e esconder o erro faria o
    // contador mandar por WhatsApp um endereço que ainda não abre.
    syncError: result.syncError ?? null,
    captureBase: captureBaseUrl(),
  });
}
