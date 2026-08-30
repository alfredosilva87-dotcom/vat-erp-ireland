import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { listarClientesDoCliente, guardarClienteDoCliente } from "@/lib/invoicing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Os clientes DO NOSSO CLIENTE — a quem ele emite faturas. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const incluirInativos = req.nextUrl.searchParams.get("todos") === "1";
  return NextResponse.json({ clientes: await listarClientesDoCliente(params.id, incluirInativos) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const r = await guardarClienteDoCliente(params.id, null, await req.json());
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ cliente: r.cliente });
}
