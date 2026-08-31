import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { conciliacaoFiscal } from "@/lib/fiscal/conciliacaoDados";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Lê os documentos do período, o razão e as demonstrações.
export const maxDuration = 60;

/** A conciliação fiscal — ver lib/fiscal/conciliacao.ts. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sp = req.nextUrl.searchParams;
  const ano = new Date().getFullYear();
  const de = sp.get("de") || `${ano}-01-01`;
  const ate = sp.get("ate") || `${ano}-12-31`;

  try {
    return NextResponse.json(await conciliacaoFiscal(params.id, de, ate));
  } catch (e: any) {
    // A mensagem sobe crua: quem abre esta tela é quem consegue agir sobre ela,
    // e "não deu" mandaria procurar no log do servidor.
    return NextResponse.json({ error: e?.message || "Não deu para conciliar." }, { status: 500 });
  }
}
