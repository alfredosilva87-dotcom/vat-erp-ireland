import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O de-para: o plano de contas do cliente e o nosso.
 *
 * Devolve junto o nosso plano, porque a tela precisa dos dois lados ao
 * mesmo tempo — e uma segunda chamada para buscar as contas de destino
 * só faria a tela piscar.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sb = getServerSupabase();
  const [{ data: mapa }, { data: contas }] = await Promise.all([
    sb.from("account_mapping").select("*").eq("client_id", params.id).order("external_code"),
    sb.from("chart_of_accounts")
      .select("code,description,type,report_group")
      .not("type", "is", null).eq("active", true).eq("postable", true).order("code"),
  ]);

  return NextResponse.json({ mapping: mapa ?? [], accounts: contas ?? [] });
}

/**
 * Grava o de-para inteiro de uma vez.
 *
 * Substituir o conjunto todo, em vez de linha a linha, é o que faz a
 * tela poder ser uma tabela editável simples: o que sumiu da lista foi
 * removido, e não é preciso rastrear cada apagar.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const user = await getSessionUser();

  const body = await req.json().catch(() => null);
  const linhas = Array.isArray(body?.mapping) ? body.mapping : null;
  if (!linhas) return NextResponse.json({ error: "Invalid body." }, { status: 400 });

  const sb = getServerSupabase();

  // Só entram destinos que existem no plano: um de-para apontando para
  // uma conta inexistente falharia depois, na carga, quando o erro já
  // custa mais para entender.
  const { data: contas } = await sb.from("chart_of_accounts")
    .select("code").not("type", "is", null).eq("active", true).eq("postable", true);
  const validas = new Set(((contas ?? []) as any[]).map((c) => c.code));

  const limpas = linhas
    .filter((l: any) => String(l?.external_code || "").trim() && validas.has(String(l?.account_code || "").trim()))
    .map((l: any) => ({
      client_id: params.id,
      external_code: String(l.external_code).trim(),
      external_name: l.external_name ? String(l.external_name).trim() : null,
      account_code: String(l.account_code).trim(),
      created_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    }));

  await sb.from("account_mapping").delete().eq("client_id", params.id);
  if (limpas.length) {
    const { error } = await sb.from("account_mapping").insert(limpas);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const recusadas = linhas.length - limpas.length;
  return NextResponse.json({ saved: limpas.length, rejected: recusadas });
}
