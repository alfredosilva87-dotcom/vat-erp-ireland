import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { devolverDocumento, estadoDaIntegracao, type Origem } from "@/lib/financial/devolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DEVOLVER o documento — tirar de contas a pagar/receber e do razão.
 *
 * O inverso da integração, e o passo que faltava antes de se poder corrigir ou
 * apagar um documento já contabilizado. Ver `lib/financial/devolver.ts`.
 *
 * NÃO apaga o documento: ele fica intacto e volta ao estado de "por integrar",
 * pronto para ser corrigido e contabilizado de novo. Quem quiser apagá-lo faz
 * isso a seguir, e aí a trava já não impede.
 */

const origemValida = (v: string): v is Origem => v === "purchase" || v === "sale";

export async function GET(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const origem = new URL(req.url).searchParams.get("origem") || "";
  if (!origemValida(origem)) {
    return NextResponse.json({ error: "Falta dizer se é compra ou venda." }, { status: 400 });
  }
  return NextResponse.json(await estadoDaIntegracao(params.id, params.docId, origem));
}

export async function POST(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const body = await req.json().catch(() => ({}));
  const origem = String(body?.origem || "");
  if (!origemValida(origem)) {
    return NextResponse.json({ error: "Falta dizer se é compra ou venda." }, { status: 400 });
  }

  const r = await devolverDocumento(params.id, params.docId, origem);
  // 409 e não 400: o pedido está bem formado, é o ESTADO do título que impede
  // — há baixa ou encargo por desfazer primeiro.
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 409 });

  /*
   * Fica na trilha da nota, com nome e hora.
   *
   * Devolver desfaz contabilidade, e uma auditoria pergunta quem desfez e
   * quando. Só do lado da compra existe `invoice_audit`; a venda ainda não tem
   * trilha própria, e registá-la em silêncio noutro sítio seria pior do que a
   * ausência assumida — ver a fila em docs.
   */
  if (origem === "purchase") {
    const user = await getSessionUser();
    await getServerSupabase().from("invoice_audit").insert({
      invoice_id: params.docId,
      actor_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      action: "edited",
      field: "integracao",
      old_value: "integrado",
      new_value: "devolvido",
      note: `Devolvido: ${r.titulosRemovidos} título(s) e ${r.lancamentosRemovidos} lançamento(s) removidos.`,
    });
  }

  return NextResponse.json(r);
}
