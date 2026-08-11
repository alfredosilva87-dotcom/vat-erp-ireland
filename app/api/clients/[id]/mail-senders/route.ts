import { NextRequest, NextResponse } from "next/server";
import { createMailSender, listMailSenders } from "@/lib/mailStore";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  return NextResponse.json({ senders: await listMailSenders(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const body = await req.json().catch(() => ({}));
  const { sender, error } = await createMailSender({
    // `global: true` cadastra a regra para todos os clientes do escritório —
    // um domínio de spam não precisa ser bloqueado vinte vezes.
    client_id: body?.global ? null : params.id,
    pattern: body?.pattern,
    mode: body?.mode === "block" ? "block" : "allow",
    note: body?.note ?? null,
  });
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ sender });
}
