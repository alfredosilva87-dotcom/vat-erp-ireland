import { NextRequest, NextResponse } from "next/server";
import { deletePhoneLink, rotatePhoneLink, setPhoneLinkActive, syncOne, listPhoneLinks } from "@/lib/phoneLinkStore";
import { captureBaseUrl } from "@/lib/relay";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liga, desliga, troca o token e tenta sincronizar de novo.
 *
 * O guarda é o do CLIENTE da URL, e o link é conferido como pertencente a ele —
 * senão o id de um link de outro escritório passaria só por vir num caminho
 * cujo cliente é meu.
 */
async function owned(clientId: string, linkId: string) {
  const links = await listPhoneLinks(clientId);
  return links.find((l) => l.id === linkId) ?? null;
}

export async function PATCH(
  req: NextRequest, { params }: { params: { id: string; linkId: string } }
) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const link = await owned(params.id, params.linkId);
  // 404 e não 403: "existe, mas não é seu" já conta que existe.
  if (!link) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  if (body?.rotate === true) {
    const r = await rotatePhoneLink(params.linkId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ link: r.link, syncError: r.error ?? null, captureBase: captureBaseUrl() });
  }

  if (body?.resync === true) {
    const s = await syncOne(link);
    if (!s.ok) return NextResponse.json({ error: s.error }, { status: 400 });
    const links = await listPhoneLinks(params.id);
    return NextResponse.json({ link: links.find((l) => l.id === params.linkId) ?? link });
  }

  if (typeof body?.active === "boolean") {
    const r = await setPhoneLinkActive(params.linkId, body.active);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ link: r.link });
  }

  return NextResponse.json({ error: "Nada a alterar." }, { status: 400 });
}

export async function DELETE(
  _req: NextRequest, { params }: { params: { id: string; linkId: string } }
) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const link = await owned(params.id, params.linkId);
  if (!link) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const r = await deletePhoneLink(params.linkId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
