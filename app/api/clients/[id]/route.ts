import { NextRequest, NextResponse } from "next/server";
import { getClient, updateClient, deleteClient } from "@/lib/store";
import { requireRole, getSessionUser } from "@/lib/auth";
import { denied, requireClient } from "@/lib/access";
import { vinculosDe, corpoDoImpedimento } from "@/lib/cadastros/vinculos";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const company = (await getSessionUser())?.company_id ?? null;
  const client = await getClient(params.id, company);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ client });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const patch = await req.json();
  const client = await updateClient(params.id, patch);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ client });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  // Destructive: administrators only. The UI hides these buttons, but the
  // check has to live here to actually be a permission.
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  /*
   * A TRAVA, ANTES DE TOCAR NO BANCO.
   *
   * O gatilho da migração 057 é quem garante isto de verdade — mas ele fala
   * por excepção do Postgres, e uma excepção não traz a CONTAGEM. Aqui conta-se
   * primeiro, para o ecrã poder dizer "5 compras, 12 lançamentos no razão, 3
   * meses fechados" em vez de "não foi possível apagar".
   *
   * Os dois existem de propósito: este explica, aquele impede.
   */
  const veredito = await vinculosDe("cliente", params.id);
  if (!veredito.pode) {
    return NextResponse.json(corpoDoImpedimento(veredito), { status: 409 });
  }

  const ok = await deleteClient(params.id);
  return NextResponse.json({ ok });
}
