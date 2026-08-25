import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { ehVisao, loadComparative } from "@/lib/accounting/comparative";
import { buildAccountingWorkbook } from "@/lib/accounting/exportDocs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A visao completa le tres anos do razao; nos clientes com movimento a serio
// isso passa dos 10s padrao da Vercel.
export const maxDuration = 120;

/**
 * Os relatorios num livro so, com painel, DRE, balanco e balancete.
 *
 * `view=completa` traz a coluna do ano anterior, os cartoes de KPI e os
 * graficos; `view=enxuta` (o padrao) traz so as demonstracoes. A escolha e da
 * pessoa na hora de gerar — a completa e para entregar ao cliente, a enxuta e
 * para conferir numero.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sp = new URL(req.url).searchParams;
  const ano = Number(sp.get("year")) || new Date().getFullYear();
  const visaoPedida = sp.get("view");
  const visao = ehVisao(visaoPedida) ? visaoPedida : "enxuta";

  const c = await loadComparative(params.id, ano, visao);

  const nome = `${c.atual.client?.client_code || "cliente"}-contas-${ano}-${visao}.xlsx`
    .replace(/[^\w.\-]/g, "_");
  // `Blob` e nao o Uint8Array cru: e o unico tipo que o `NextResponse` aceita
  // como corpo em todas as versoes do @types/node sem cast, e cast aqui
  // esconderia um erro real de tipo de corpo.
  return new NextResponse(new Blob([await buildAccountingWorkbook(c)]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
