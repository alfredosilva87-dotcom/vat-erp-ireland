import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { zipDeDocumentos } from "@/lib/fiscal/cofre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Lê vários ficheiros do armazenamento e comprime-os.
export const maxDuration = 60;

/**
 * Vários documentos do cofre num ZIP arrumado por tipo.
 *
 * POST e não GET porque a lista de ids vai no corpo: uma dúzia de uuids numa
 * query string passa dos limites de comprimento de URL de alguns servidores, e
 * é exactamente o caso de uso — descarregar o dossiê inteiro.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids) ? body.ids.filter((s: unknown) => typeof s === "string") : [];

  const r = await zipDeDocumentos(params.id, ids);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });

  return new NextResponse(r.bytes as any, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${r.nome}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      // A tela mostra quantos entraram: um ZIP com onze de doze ficheiros nao
      // deve parecer completo.
      "X-Documentos-Incluidos": String(r.incluidos),
    },
  });
}
