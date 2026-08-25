import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { tiposDeEncargo } from "@/lib/financial/chargeTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Os tipos de encargo do escritório — juros, taxa, multa, desconto.
 *
 * Referência global, como o plano de contas: não há cliente a guardar. Ler
 * exige sessão; mexer exige admin, porque mudar a conta de "juros" muda para
 * onde vai o resultado de todos os clientes.
 */
export async function GET() {
  const guard = await requireRole("user");
  if ("error" in guard) return guard.error;
  return NextResponse.json({ types: await tiposDeEncargo() });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  const key = String(body?.key || "").trim();
  if (!key) return NextResponse.json({ error: "Falta o tipo." }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: guard.user.id };
  for (const campo of ["label", "account_payable", "account_receivable"]) {
    if (campo in body) {
      const v = String(body[campo] ?? "").trim();
      if (!v) return NextResponse.json({ error: `${campo} não pode ficar vazio.` }, { status: 400 });
      patch[campo] = v;
    }
  }
  if ("active" in body) patch.active = !!body.active;

  const { data, error } = await getServerSupabase()
    .from("charge_types").update(patch).eq("key", key).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ type: data });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  const key = String(body?.key || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!key) return NextResponse.json({ error: "A chave é obrigatória (letras e números)." }, { status: 400 });

  const linha = {
    key,
    label: String(body?.label || key).trim(),
    account_payable: String(body?.account_payable || "").trim(),
    account_receivable: String(body?.account_receivable || "").trim(),
    effect: body?.effect === "decrease" ? "decrease" : "increase",
    sort: Number(body?.sort) || 100,
  };
  if (!linha.account_payable || !linha.account_receivable) {
    return NextResponse.json(
      { error: "Informe a conta dos dois lados: a pagar e a receber." }, { status: 400 }
    );
  }

  const { data, error } = await getServerSupabase()
    .from("charge_types").insert(linha).select().single();
  if (error) {
    const dup = /duplicate key/i.test(error.message);
    return NextResponse.json(
      { error: dup ? "Já existe um tipo com essa chave." : error.message }, { status: 400 }
    );
  }
  return NextResponse.json({ type: data });
}
