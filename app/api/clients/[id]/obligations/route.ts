import { NextRequest, NextResponse } from "next/server";
import { getObligations, refreshObligations, monthlySeries } from "@/lib/store";
import { denied, requireClient } from "@/lib/access";
import { pagamentoDasObrigacoes } from "@/lib/fiscal/pagamentoDaObrigacao";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const sp = new URL(req.url).searchParams;
  const year = Number(sp.get("year")) || new Date().getFullYear();
  const obligations = sp.get("refresh") === "1"
    ? await refreshObligations(params.id, year)
    : await getObligations(params.id, year);
  /*
   * O estado de PAGAMENTO vem junto, e não numa segunda chamada.
   *
   * Entregar e pagar são dois factos, e a tela só sabia o primeiro. Ver
   * lib/fiscal/pagamentoDaObrigacao.ts para a ligação — é a referência do
   * título, a mesma que `criarTituloDeImposto` escreve.
   */
  return NextResponse.json({
    obligations,
    payments: await pagamentoDasObrigacoes(params.id, obligations as any),
    series: await monthlySeries(params.id, year),
    year,
  });
}
