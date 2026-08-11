import { NextRequest, NextResponse } from "next/server";
import { getInvoice, updateInvoiceCredits, updateInvoice, deleteInvoice } from "@/lib/store";
import { getSessionUser, requireRole } from "@/lib/auth";
import { listAudit, listInvoiceDocuments } from "@/lib/reviewStore";
import { denied, requireInvoice } from "@/lib/access";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireInvoice(params.id);
  if (denied(access)) return access.error;

  const data = await getInvoice(params.id);
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // A trilha e os documentos extras vem junto (camada B3): a pergunta "quem
  // mudou isso?" e feita olhando a nota, nao numa tela separada que ninguem
  // lembra que existe.
  const [audit, documents] = await Promise.all([
    listAudit(params.id),
    listInvoiceDocuments(params.id),
  ]);
  return NextResponse.json({ ...data, audit, documents });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireInvoice(params.id);
  if (denied(access)) return access.error;

  const body = await req.json();
  // Quem esta alterando vai para a trilha. Sem isto o historico diria "alguem
  // mudou o valor", que numa auditoria nao vale nada.
  const actor = await getSessionUser();
  // credits-only payload (legacy) vs general header/items edit
  const data =
    body?.credits && !body?.header && !body?.items
      ? await updateInvoiceCredits(params.id, body.credits as Record<string, boolean>)
      : await updateInvoice(params.id, { header: body?.header, items: body?.items }, actor);
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireInvoice(params.id);
  if (denied(access)) return access.error;

  // Destructive: administrators only. The UI hides these buttons, but the
  // check has to live here to actually be a permission.
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const ok = await deleteInvoice(params.id);
  return NextResponse.json({ ok });
}
