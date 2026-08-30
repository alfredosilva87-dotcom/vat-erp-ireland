import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { guardarClienteDoCliente, apagarClienteDoCliente } from "@/lib/invoicing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string; customerId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const r = await guardarClienteDoCliente(params.id, params.customerId, await req.json());
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ cliente: r.cliente });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; customerId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const r = await apagarClienteDoCliente(params.id, params.customerId);
  // 409 e nao 400: o pedido estava certo, o estado e que impede — o cliente tem
  // faturas e foi inativado. A tela distingue as duas coisas.
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 409 });
  return NextResponse.json({ ok: true });
}
