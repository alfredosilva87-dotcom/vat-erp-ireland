import { NextRequest, NextResponse } from "next/server";
import { ensureMailRoute, listMailRoutes } from "@/lib/mailStore";
import { readMailConfig } from "@/lib/mailFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Os endereços deste cliente, com o endereço base junto.
 *
 * O base vem do ambiente e não do banco, então a tela não consegue montar
 * `notas+token@dominio` sozinha — e mostrar só o token seria dar ao contador
 * metade do que ele precisa copiar para o pedido do fornecedor.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { config } = readMailConfig();
  return NextResponse.json({
    routes: await listMailRoutes(params.id),
    inbox_address: config?.inboxAddress ?? null,
    configured: Boolean(config),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const direction = body?.direction === "sale" ? "sale" : "purchase";
  const route = await ensureMailRoute(params.id, direction);
  if (!route) return NextResponse.json({ error: "Não foi possível gerar o endereço. Tente de novo." }, { status: 500 });
  return NextResponse.json({ route });
}
