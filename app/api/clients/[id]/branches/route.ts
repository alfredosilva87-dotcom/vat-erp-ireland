import { NextRequest, NextResponse } from "next/server";
import { listBranches, createBranch } from "@/lib/store";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ branches: await listBranches(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const branch = await createBranch(params.id, body || {});
  if (!branch) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  return NextResponse.json({ branch });
}
