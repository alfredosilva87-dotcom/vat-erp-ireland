import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { timbreDoCliente } from "@/lib/accounting/comparative";
import { contasPedidas, loadLedger, recorte } from "@/lib/accounting/ledger";
import { buildLedgerPdf } from "@/lib/accounting/exportLedger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * O razao em PDF, no papel timbrado do escritorio.
 *
 * Imprime exatamente as contas e o recorte de datas que a tela tinha. Um
 * export que traz o razao inteiro quando se pediram tres contas nao e um
 * export a mais: e a folha errada em cima da mesa na reuniao de conciliacao.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sp = new URL(req.url).searchParams;
  const { de, ate } = recorte(sp);
  if (de > ate) {
    return NextResponse.json({ error: "A data inicial e depois da final." }, { status: 400 });
  }

  const [razao, escritorio] = await Promise.all([
    loadLedger(params.id, de, ate, contasPedidas(sp)),
    timbreDoCliente(params.id),
  ]);

  const nome = `${razao.client?.client_code || "cliente"}-razao-${de}-a-${ate}.pdf`
    .replace(/[^\w.\-]/g, "_");
  // `Blob` e nao o Uint8Array cru: e o unico tipo que o `NextResponse` aceita
  // como corpo em todas as versoes do @types/node sem cast.
  return new NextResponse(new Blob([await buildLedgerPdf(razao, escritorio)]), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
