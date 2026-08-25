import { NextRequest, NextResponse } from "next/server";
import { listAccounts, createAccount, bulkImportAccounts } from "@/lib/store";
import { getServerSupabase } from "@/lib/supabase";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  /*
   * Duas listas, e elas NÃO são a mesma coisa.
   *
   * `accounts` é o plano do próprio cliente (`chart_of_accounts` com o
   * `client_id` dele) — o que esta tela sempre mostrou.
   *
   * `ledgerAccounts` é o plano COMPARTILHADO (`client_id` nulo), que é o que o
   * motor contábil usa de facto: é dele que saem as rubricas do balanço e do
   * DRE, e é nele que estão 1100 Bank, 2100 Trade creditors e companhia.
   *
   * A separação fica exposta de propósito. Que a tela "Plano de contas" mostre
   * um plano e a contabilidade use outro é uma inconsistência real, anterior a
   * esta mudança; devolvê-la em duas chaves deixa isso visível em vez de
   * escondido, e permite a quem precisa do plano de verdade (a escolha da
   * conta de uma conta bancária, por exemplo) pedir o certo.
   */
  const { data: doRazao } = await getServerSupabase()
    .from("chart_of_accounts")
    .select("id,code,description,type,report_group,postable")
    .is("client_id", null).eq("active", true).order("code");

  return NextResponse.json({
    accounts: await listAccounts(params.id),
    ledgerAccounts: doRazao ?? [],
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const body = await req.json();
  if (Array.isArray(body?.rows)) {
    const count = await bulkImportAccounts(params.id, body.rows);
    return NextResponse.json({ imported: count });
  }
  /*
   * A criação agora RECUSA por regra (a faixa 9000–9899) e por conflito de
   * código. Sem este `try`, as duas voltavam como 500 de corpo vazio: a tela
   * mostrava "não gravou" sem dizer porquê, e o motivo — que é acionável, "essa
   * conta é do escritório" — ficava no log do servidor.
   */
  try {
    const account = await createAccount(params.id, body || {});
    if (!account) return NextResponse.json({ error: "O código da conta é obrigatório." }, { status: 400 });
    return NextResponse.json({ account });
  } catch (e: any) {
    const msg = String(e?.message || "Falhou.");
    const duplicada = /duplicate key|already exists/i.test(msg);
    return NextResponse.json(
      { error: duplicada ? "Já existe uma conta com esse código neste cliente." : msg },
      { status: 400 }
    );
  }
}
